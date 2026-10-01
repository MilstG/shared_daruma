// Passkeys (WebAuthn) for Pulse members — zero dependencies, Node's crypto only.
//
// Registration ("Add a passkey on this device") and sign-in ("Sign in with a passkey") are
// checked here the way the WebAuthn spec says a relying party must: the client data names the
// right ceremony, our single-use challenge and our origin; the authenticator data is for our
// RP ID with the user present; and a sign-in signature verifies against the public key stored
// at registration, with a signature counter that never goes backwards. Attestation is "none":
// we trust the key the member's device made, not a vendor certificate chain.
// Algorithms: ES256 (-7), EdDSA/Ed25519 (-8), RS256 (-257) — what browsers and platform
// authenticators actually produce.
'use strict';
const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64url');
const fromB64u = s => { if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 8192) throw new Error('bad base64url'); return Buffer.from(s, 'base64url'); };
const sha256 = b => crypto.createHash('sha256').update(b).digest();

// Minimal CBOR (RFC 8949) decoder: unsigned/negative ints, byte/text strings, arrays, maps,
// false/true/null. Enough for attestation objects and COSE keys; anything else is refused.
function cborDecode(buf, start) {
  let i = start || 0;
  const need = n => { if (i + n > buf.length) throw new Error('CBOR truncated'); };
  const len = info => {
    if (info < 24) return info;
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (n < 0) throw new Error('CBOR: indefinite lengths not supported');
    need(n); let v = 0; for (let k = 0; k < n; k++) v = v * 256 + buf[i + k]; i += n; return v;
  };
  const item = depth => {
    if (depth > 16) throw new Error('CBOR too deep');
    need(1); const b = buf[i++], major = b >> 5, info = b & 31;
    if (major === 0) return len(info);
    if (major === 1) return -1 - len(info);
    if (major === 2) { const n = len(info); need(n); const v = buf.subarray(i, i + n); i += n; return v; }
    if (major === 3) { const n = len(info); need(n); const v = buf.subarray(i, i + n).toString('utf8'); i += n; return v; }
    if (major === 4) { const n = len(info); if (n > 1000) throw new Error('CBOR array too long'); const a = []; for (let k = 0; k < n; k++) a.push(item(depth + 1)); return a; }
    if (major === 5) { const n = len(info); if (n > 1000) throw new Error('CBOR map too long'); const m = new Map(); for (let k = 0; k < n; k++) { const key = item(depth + 1); m.set(key, item(depth + 1)); } return m; }
    if (major === 7) { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; }
    throw new Error('CBOR: unsupported item');
  };
  const value = item(0);
  return { value, end: i };
}

// authenticator data: rpIdHash(32) | flags(1) | signCount(4) | [aaguid(16) credIdLen(2) credId COSEkey]
function parseAuthData(ad) {
  if (!Buffer.isBuffer(ad) || ad.length < 37) throw new Error('authenticator data too short');
  const flags = ad[32];
  const out = { rpIdHash: ad.subarray(0, 32), up: !!(flags & 1), uv: !!(flags & 4), at: !!(flags & 64), signCount: ad.readUInt32BE(33) };
  if (out.at) {
    if (ad.length < 55) throw new Error('attested credential data missing');
    const n = ad.readUInt16BE(53);
    if (n < 1 || n > 1023 || ad.length < 55 + n) throw new Error('bad credential id');
    out.credId = ad.subarray(55, 55 + n);
    const k = cborDecode(ad, 55 + n);
    out.cose = k.value; out.coseBytes = ad.subarray(55 + n, k.end);
  }
  return out;
}

// COSE_Key -> {alg, jwk}
function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new Error('bad COSE key');
  const kty = cose.get(1), alg = cose.get(3), b = k => { const v = cose.get(k); if (!Buffer.isBuffer(v)) throw new Error('bad COSE key'); return b64u(v); };
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b(-2), y: b(-3) } };
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) return { alg: -8, jwk: { kty: 'OKP', crv: 'Ed25519', x: b(-2) } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b(-1), e: b(-2) } };
  throw new Error('unsupported key type (use ES256, Ed25519 or RS256)');
}

function checkClientData(json, type, expect) {
  let cd; try { cd = JSON.parse(json.toString('utf8')); } catch (e) { throw new Error('bad client data'); }
  if (cd.type !== type) throw new Error('wrong ceremony');
  if (cd.challenge !== expect.challenge) throw new Error('challenge mismatch');
  if (!(expect.origins || [expect.origin]).includes(cd.origin)) throw new Error('origin mismatch: ' + String(cd.origin).slice(0, 80));
  if (cd.crossOrigin === true) throw new Error('cross-origin requests are not accepted');
  return cd;
}
function checkRp(auth, rpId, needUv) {
  if (!auth.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error('wrong RP ID');
  if (!auth.up) throw new Error('user not present');
  if (needUv && !auth.uv) throw new Error('user not verified');
}

// cred: the PublicKeyCredential the browser returned, JSON-ified (base64url fields)
// expect: {challenge (b64url), origin | origins, rpId, requireUv?}
function verifyRegistration(cred, expect) {
  if (!cred || cred.type !== 'public-key' || !cred.response) throw new Error('not a passkey');
  const cdj = fromB64u(cred.response.clientDataJSON);
  checkClientData(cdj, 'webauthn.create', expect);
  const att = cborDecode(fromB64u(cred.response.attestationObject)).value;
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new Error('bad attestation object');
  const auth = parseAuthData(att.get('authData'));
  checkRp(auth, expect.rpId, expect.requireUv);
  if (!auth.at || !auth.credId) throw new Error('no credential in the response');
  const id = b64u(auth.credId);
  if (cred.id && cred.id !== id) throw new Error('credential id mismatch');
  const { alg, jwk } = coseToJwk(auth.cose);
  crypto.createPublicKey({ key: jwk, format: 'jwk' }); // throws on a malformed key
  return { id, alg, jwk, signCount: auth.signCount, uv: auth.uv };
}

// stored: {alg, jwk, signCount}; returns the new signCount
function verifyAssertion(cred, expect, stored) {
  if (!cred || cred.type !== 'public-key' || !cred.response) throw new Error('not a passkey');
  const cdj = fromB64u(cred.response.clientDataJSON);
  checkClientData(cdj, 'webauthn.get', expect);
  const ad = fromB64u(cred.response.authenticatorData);
  const auth = parseAuthData(ad);
  checkRp(auth, expect.rpId, expect.requireUv);
  const data = Buffer.concat([ad, sha256(cdj)]);
  const sig = fromB64u(cred.response.signature);
  const key = crypto.createPublicKey({ key: stored.jwk, format: 'jwk' });
  const ok = stored.alg === -8 ? crypto.verify(null, data, key, sig)
    : stored.alg === -7 ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig)
    : stored.alg === -257 ? crypto.verify('sha256', data, key, sig) : false;
  if (!ok) throw new Error('signature does not verify');
  // a counter that goes backwards means a cloned authenticator (0 = this device doesn't count)
  if ((stored.signCount || 0) > 0 || auth.signCount > 0) {
    if (auth.signCount <= (stored.signCount || 0)) throw new Error('signature counter went backwards — possible cloned passkey');
  }
  return { signCount: auth.signCount, uv: auth.uv };
}

const newChallenge = () => b64u(crypto.randomBytes(32));

module.exports = { cborDecode, parseAuthData, coseToJwk, verifyRegistration, verifyAssertion, newChallenge, b64u, fromB64u };
