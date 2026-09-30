// Pulse accounts (v0.3): claiming a wallet with a Sign-In with Ethereum signature, signing in on
// another device with that wallet or with a one-time code, and the end-to-end encrypted journal
// sync (the server stores ciphertext only). Signatures are checked against ethers-made vectors.
import { readFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { t, ok, eq, report, makeExtractor } from './harness.mjs';

const require = createRequire(import.meta.url);
const S = require('../social.js');
const sig = require('../vendor/eth-sig.js');
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const html = readFileSync(htmlPath, 'utf8');
const vectors = JSON.parse(readFileSync(new URL('./eth-vectors.json', import.meta.url), 'utf8'));

console.log('\nSignatures');
t('recovers the signer of wallet-made personal_sign signatures (vectors signed with ethers)', () => {
  for (const v of vectors) eq(sig.recoverAddress(v.message, v.signature), v.address.toLowerCase(), v.message.slice(0, 30));
});
t('EIP-55 checksums match the vectors, and bad input throws instead of recovering someone', () => {
  for (const v of vectors) eq(sig.toChecksumAddress(v.address.toLowerCase()), v.address);
  const v = vectors[0];
  ok(sig.recoverAddress(v.message + ' ', v.signature) !== v.address.toLowerCase(), 'a changed message recovers someone else');
  let threw = 0;
  for (const bad of ['0x', '0x1234', v.signature.slice(0, -2) + '05', 'zz'.repeat(65)]) try { sig.recoverAddress(v.message, bad); } catch (e) { threw++; }
  eq(threw, 4);
});
t('the test signer matches the recovery (what a wallet does)', () => {
  const k = '0x' + '42'.repeat(32), a = sig.addressOfPrivateKey(k);
  eq(sig.recoverAddress('hello', sig.signPersonal('hello', k)), a);
});
t('the Sign-In with Ethereum message has the EIP-4361 shape wallets recognise', () => {
  const m = S.siweMessage({ domain: 'pulse.example', uri: 'https://pulse.example', address: vectors[0].address, statement: 'Claim this wallet.',
    nonce: 'abcdef0123456789', issuedAt: '2026-09-30T12:00:00.000Z', expirationTime: '2026-09-30T12:10:00.000Z' });
  eq(m.split('\n'), ['pulse.example wants you to sign in with your Ethereum account:', vectors[0].address, '', 'Claim this wallet.', '',
    'URI: https://pulse.example', 'Version: 1', 'Chain ID: 1', 'Nonce: abcdef0123456789', 'Issued At: 2026-09-30T12:00:00.000Z', 'Expiration Time: 2026-09-30T12:10:00.000Z']);
});
t('encrypted journals are checked for shape only', () => {
  const good = { v: 1, iter: 310000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ct: 'QUJD' };
  eq(S.sanitizeVaultBlob(good), good);
  ok(!S.sanitizeVaultBlob({ ...good, v: 2 }));
  ok(!S.sanitizeVaultBlob({ ...good, iter: 10 }), 'weak key stretching refused');
  ok(!S.sanitizeVaultBlob({ ...good, ct: 'not base64!' }));
  ok(!S.sanitizeVaultBlob({ ...good, journal: {} }) || !('journal' in S.sanitizeVaultBlob({ ...good, journal: {} })), 'extra fields dropped');
});

console.log('\nHTTP');
const listen = app => new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
const K1 = '0x' + '11'.repeat(32), K2 = '0x' + '22'.repeat(32);
const W1 = sig.addressOfPrivateKey(K1), W2 = sig.addressOfPrivateKey(K2);
let portfolioFor = [];
const fetchImpl = async (url, o) => { const b = JSON.parse(o.body);
  if (b.type === 'portfolio') portfolioFor.push(String(b.user).toLowerCase());
  const out = b.type === 'portfolio' ? [['month', { accountValueHistory: [[Date.parse('2026-09-01'), '1000'], [Date.parse('2026-09-30'), '1100']],
    pnlHistory: [[Date.parse('2026-09-01'), '0'], [Date.parse('2026-09-30'), '100']] }]] : [];
  return { ok: true, status: 200, json: async () => out }; };
let clock = Date.parse('2026-09-30T12:00:00Z');
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-acct-'));
const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, fetchImpl, now: () => clock });
const B = await listen(app);
const call = async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.admin ? { Authorization: 'Bearer owner-token' } : {}), ...(o.headers || {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json() }; };
const tick = () => new Promise(r => setTimeout(r, 30));
// what a wallet does: sign the server's message
const signFlow = async (purpose, priv, address, key) => {
  const st = await call('/' + purpose + '/start', { method: 'POST', key, body: { address } });
  if (st.status !== 200) return st;
  return call('/' + purpose + '/finish', { method: 'POST', key, body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, priv) } });
};
let A, Bk, Aid;
try {
  await t('joining with a wallet: nothing is proven yet', async () => {
    A = (await call('/join', { method: 'POST', body: { handle: 'alpha', address: W1, share: { ret: true } } })).d.key;
    Bk = (await call('/join', { method: 'POST', body: { handle: 'bravo', address: W1 } })).d.key;
    const me = (await call('/me', { key: A })).d.me;
    eq(me.claimed, false); eq(me.claimedAddress, null); eq(me.devices, 1);
    Aid = (await call('/admin/members', { admin: true })).d.members.find(m => m.handle === 'alpha').id;
  });
  await t('the claim message is written by the server for this host and names the member', async () => {
    const st = await call('/claim/start', { method: 'POST', key: A, body: { address: W1.toUpperCase().replace('0X', '0x') }, headers: { 'X-Forwarded-Proto': 'https' } });
    eq(st.status, 200);
    const host = B.replace('http://', '');
    ok(st.d.message.startsWith(host + ' wants you to sign in with your Ethereum account:\n' + sig.toChecksumAddress(W1) + '\n'));
    ok(st.d.message.includes('Claim this wallet for @alpha on Pulse.') && st.d.message.includes('URI: https://' + host));
    eq((await call('/claim/start', { method: 'POST', body: { address: W1 } })).status, 401, 'claiming needs a member key');
    eq((await call('/claim/start', { method: 'POST', key: A, body: { address: 'nope' } })).status, 400);
  });
  await t('a signature from another wallet, a reused nonce, or a nonce for the other purpose is refused', async () => {
    let st = await call('/claim/start', { method: 'POST', key: A, body: { address: W1 } });
    const wrong = await call('/claim/finish', { method: 'POST', key: A, body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, K2) } });
    eq(wrong.status, 403);
    eq((await call('/claim/finish', { method: 'POST', key: A, body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, K1) } })).status, 400, 'the nonce died with the failed try');
    st = await call('/claim/start', { method: 'POST', key: A, body: { address: W1 } });
    eq((await call('/login/finish', { method: 'POST', body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, K1) } })).status, 400, 'a claim nonce can’t sign in');
    st = await call('/claim/start', { method: 'POST', key: A, body: { address: W1 } });
    eq((await call('/claim/finish', { method: 'POST', key: A, body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message.replace('alpha', 'bravo'), K1) } })).status, 403,
      'only the exact text the server wrote counts');
    st = await call('/claim/start', { method: 'POST', key: A, body: { address: W1 } });
    clock += 11 * 60000;
    eq((await call('/claim/finish', { method: 'POST', key: A, body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, K1) } })).status, 400, 'expired after 10 minutes');
    eq((await call('/claim/finish', { method: 'POST', key: A, body: { nonce: '__proto__', signature: '0x' } })).status, 400);
  });
  await t('claiming locks the wallet: the impostor loses it and nobody else can name it', async () => {
    const r = await signFlow('claim', K1, W1, A);
    eq(r.status, 200); eq(r.d.me.claimed, true); eq(r.d.me.claimedAddress, W1);
    const ms = (await call('/admin/members', { admin: true })).d.members;
    eq(ms.find(m => m.handle === 'bravo').address, null, 'bravo had typed the same address and lost it');
    eq(ms.find(m => m.handle === 'alpha').claimed, W1);
    eq((await call('/me', { method: 'PUT', key: Bk, body: { address: W1 } })).status, 409);
    const j = await call('/join', { method: 'POST', body: { handle: 'copycat', address: W1 } });
    eq(j.status, 200); eq(j.d.walletTaken, true);
    eq((await call('/admin/members', { admin: true })).d.members.find(m => m.handle === 'copycat').address, null);
    await call('/me', { method: 'DELETE', key: j.d.key });
    eq((await call('/profile/alpha', { key: Bk })).d.profile.claimed, true, 'others see the ✓');
    eq((await call('/profile/alpha', { key: Bk })).d.profile.claimedAddress, undefined, 'but not the address');
  });
  await t('a claimed member’s address can’t be changed or cleared by a plain save', async () => {
    await call('/me', { method: 'PUT', key: A, body: { address: W2 } });
    await call('/me', { method: 'PUT', key: A, body: { address: null, share: { verify: false } } });
    eq((await call('/admin/members', { admin: true })).d.members.find(m => m.handle === 'alpha').address, W1);
  });
  let A2;
  await t('signing in with the claimed wallet on a new device issues a new key; the old one keeps working', async () => {
    eq((await signFlow('login', K2, W2)).status, 404, 'an unclaimed wallet can’t sign in');
    const st = await call('/login/start', { method: 'POST', body: { address: W1 } });
    eq((await call('/login/finish', { method: 'POST', body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, K2) } })).status, 403);
    const r = await signFlow('login', K1, W1);
    eq(r.status, 200); ok(r.d.key && r.d.key !== A); A2 = r.d.key;
    eq(r.d.me.handle, 'alpha'); eq(r.d.me.devices, 2);
    eq((await call('/me', { key: A })).status, 200); eq((await call('/me', { key: A2 })).status, 200);
    ok(!readFileSync(join(dataDir, 'social.json'), 'utf8').includes(A2), 'only the hash is stored');
  });
  let A3;
  await t('a one-time code from a signed-in device adds another device', async () => {
    const c = await call('/link/start', { method: 'POST', key: A2 });
    eq(c.status, 200); ok(/^[A-Z2-9]{10}$/.test(c.d.code));
    eq((await call('/link/finish', { method: 'POST', body: { code: 'WRONGCODE1' } })).status, 400);
    const r = await call('/link/finish', { method: 'POST', body: { code: c.d.code.toLowerCase().slice(0, 5) + '-' + c.d.code.slice(5) } });
    eq(r.status, 200); eq(r.d.me.handle, 'alpha'); A3 = r.d.key;
    eq((await call('/link/finish', { method: 'POST', body: { code: c.d.code } })).status, 400, 'single use');
    const c2 = await call('/link/start', { method: 'POST', key: A }); clock += 11 * 60000;
    eq((await call('/link/finish', { method: 'POST', body: { code: c2.d.code } })).status, 400, 'expires');
  });
  await t('sign out other devices keeps only the key that asked', async () => {
    const r = await call('/devices', { method: 'DELETE', key: A3 });
    eq(r.d.me.devices, 1);
    eq((await call('/me', { key: A })).status, 401); eq((await call('/me', { key: A2 })).status, 401); eq((await call('/me', { key: A3 })).status, 200);
    A = A3;
  });
  await t('the vault stores ciphertext with a revision; a stale write gets the newer copy back', async () => {
    const blob = n => ({ v: 1, iter: 310000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ct: Buffer.from('cipher-' + n).toString('base64') });
    eq((await call('/vault', { key: A })).d, { rev: 0, at: null, blob: null, max: 6 * 1024 * 1024, on: true });
    eq((await call('/vault', { method: 'PUT', key: A, body: { rev: 0, blob: blob(1) } })).d.rev, 1);
    const stale = await call('/vault', { method: 'PUT', key: A, body: { rev: 0, blob: blob(2) } });
    eq(stale.status, 409); eq(stale.d.rev, 1); eq(stale.d.blob.ct, blob(1).ct);
    eq((await call('/vault', { method: 'PUT', key: A, body: { rev: 1, blob: blob(2) } })).d.rev, 2);
    eq((await call('/vault', { key: A })).d.blob.ct, blob(2).ct);
    eq((await call('/vault', { method: 'PUT', key: A, body: { rev: 2, blob: { v: 1, journal: {} } } })).status, 400);
    eq((await call('/vault', { key: Bk })).d.blob, null, 'each member sees only their own');
    eq((await call('/vault')).status, 401);
    eq((await call('/me', { key: A })).d.me.vault.rev, 2);
    const big = await fetch(B + '/api/social/vault', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Pulse-Key': A }, body: JSON.stringify({ rev: 2, blob: { ...blob(3), ct: 'A'.repeat(7 * 1024 * 1024) } }) }).catch(() => ({ status: 'reset' }));
    ok(big.status === 413 || big.status === 'reset', 'too large: ' + big.status);
    eq((await call('/vault', { key: A })).d.rev, 2, 'nothing stored');
    const ov = (await call('/admin/overview', { admin: true })).d; eq(ov.vaults, 1); ok(ov.vaultBytes > 0); eq(ov.claimed, 1);
  });
  await t('the owner can switch journal sync off', async () => {
    await call('/admin/config', { method: 'PUT', admin: true, body: { vaultOn: false } });
    eq((await call('/vault', { method: 'PUT', key: A, body: { rev: 2, blob: { v: 1, iter: 310000, salt: 'AAAA', iv: 'AAAA', ct: 'AAAA' } } })).status, 403);
    eq((await call('/config')).d.vaultOn, false);
    await call('/admin/config', { method: 'PUT', admin: true, body: { vaultOn: true } });
  });
  await t('“claimed wallets only”: unproven wallets stop counting on money boards and in return competitions', async () => {
    const c = (await call('/join', { method: 'POST', body: { handle: 'charlie', address: '0x' + 'c'.repeat(40), share: { ret: true, verify: true } } })).d.key;
    await tick(); await call('/me', { method: 'PUT', key: A, body: { share: { ret: true } } }); await tick();
    const ret = async () => (await call('/leaderboard?board=ret', { key: c })).d.rows.map(r => r.handle).sort();
    eq(await ret(), ['alpha', 'charlie']);
    await call('/admin/config', { method: 'PUT', admin: true, body: { requireClaim: true } });
    portfolioFor = []; await tick();
    eq(await ret(), ['alpha'], 'charlie’s unproven wallet is off the board');
    await tick();
    ok(!portfolioFor.includes('0x' + 'c'.repeat(40)), 'and isn’t read from the chain any more');
    eq((await call('/leaderboard?board=discipline', { key: c })).d.verifyState, 'claim');
    const rc = await call('/admin/competitions', { method: 'POST', admin: true, body: { title: 'Ret', type: 'return', start: '2026-09-20', end: '2026-10-20' } });
    eq((await call('/competitions/' + rc.d.id + '/join', { method: 'POST', key: c })).status, 400);
    eq((await call('/competitions/' + rc.d.id + '/join', { method: 'POST', key: A })).status, 200);
    await call('/admin/config', { method: 'PUT', admin: true, body: { requireClaim: false } });
  });
  await t('releasing the claim frees the wallet; removing a member deletes their encrypted journal', async () => {
    const r = await call('/claim/release', { method: 'POST', key: A });
    eq(r.d.me.claimed, false);
    eq((await signFlow('login', K1, W1)).status, 404, 'no sign-in once released');
    eq((await call('/me', { method: 'PUT', key: Bk, body: { address: W1 } })).status, 200, 'others may name it again');
    ok(existsSync(join(dataDir, 'vault', Aid + '.json')));
    await call('/admin/members/' + Aid, { method: 'POST', admin: true, body: { action: 'remove' } });
    ok(!existsSync(join(dataDir, 'vault', Aid + '.json')));
    eq(readdirSync(join(dataDir, 'vault')).length, 0);
  });
  await t('a suspended member can’t sign in or use a device code', async () => {
    const k = (await call('/join', { method: 'POST', body: { handle: 'delta', address: W2 } })).d.key;
    eq((await signFlow('claim', K2, W2, k)).status, 200);
    const code = (await call('/link/start', { method: 'POST', key: k })).d.code;
    const id = (await call('/admin/members', { admin: true })).d.members.find(m => m.handle === 'delta').id;
    await call('/admin/members/' + id, { method: 'POST', admin: true, body: { action: 'ban' } });
    eq((await signFlow('login', K2, W2)).status, 404);
    eq((await call('/link/finish', { method: 'POST', body: { code } })).status, 403);
  });
  await t('sign-in attempts are rate limited per address of origin', async () => {
    let last = 0; for (let i = 0; i < 25; i++) last = (await call('/login/start', { method: 'POST', body: { address: '0x' + '9'.repeat(40) } })).status;
    eq(last, 429);
  });
} finally { await new Promise(res => app.close(res)); }

await t('without the signature library, claims answer 501 and everything else works', async () => {
  const s = S.createSocial({ dataDir: mkdtempSync(join(tmpdir(), 'ledger-acct-')), json: (res, c, o) => { res.c = c; res.o = o; }, authOk: () => false, adminConfigured: true, sig: null });
  const req = { method: 'POST', headers: {}, socket: {}, on(ev, f) { if (ev === 'data') f(Buffer.from('{"address":"' + W1 + '"}')); if (ev === 'end') f(); } };
  const res = {}; await s.handle(req, res, '/api/social/login/start', {}); eq(res.c, 501);
  const res2 = {}; await s.handle({ ...req, method: 'GET' }, res2, '/api/social/config', {}); eq(res2.o.claims, false);
});

console.log('\nClient: encryption and sync');
const { grabFn } = makeExtractor(html);
const line = re => { const m = html.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };
const cctx = { crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array, JSON, Math, String, Array, Object, Promise };
vm.createContext(cctx);
vm.runInContext([line(/const VAULT_STORE=[^\n]*/), line(/const vb64=[^\n]*/), line(/const unvb64=[^\n]*/),
  ...['vaultDerive', 'vaultSeal', 'vaultOpen', 'utf8Hex'].map(grabFn)].join('\n').replace(/^const /gm, 'var '), cctx);
await t('the journal is encrypted in the browser: the server-bound blob is ciphertext that only the passphrase opens', async () => {
  const salt = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const key = await cctx.vaultDerive('correct horse battery', salt);
  const data = { journal: { t1: { notes: 'secret-note-123' } }, wallets: [{ address: W1 }] };
  const blob = await cctx.vaultSeal(key, salt, data);
  eq(S.sanitizeVaultBlob(blob), blob, 'the server accepts what the browser sends');
  eq(blob.iter, 310000);
  ok(!Buffer.from(blob.ct, 'base64').toString('latin1').includes('secret-note'), 'no plaintext in the ciphertext');
  eq(await cctx.vaultOpen(await cctx.vaultDerive('correct horse battery', salt, blob.iter), blob), data);
  let failed = false; try { await cctx.vaultOpen(await cctx.vaultDerive('wrong passphrase!', salt), blob); } catch (e) { failed = true; }
  ok(failed, 'a wrong passphrase can’t open it');
  const b2 = await cctx.vaultSeal(key, salt, data); ok(b2.iv !== blob.iv && b2.ct !== blob.ct, 'a fresh IV every time');
});
t('the wallet signs the exact server text, hex-encoded for personal_sign', () => {
  eq(cctx.utf8Hex('Hi ✓'), '0x' + Buffer.from('Hi ✓').toString('hex'));
});
t('the Pulse theme now travels with backups and every sync', () => {
  ok(grabFn('snapshot').includes('pzTheme:settings.pzTheme'));
  ok(grabFn('applySnapshot').includes("typeof data.settings.pzTheme==='string'"));
});
t('every local save reaches the encrypted sync, and the owner never uses it (they already sync the whole journal)', () => {
  ok(grabFn('markJEdit').includes('vaultMark(id)'));
  ok(html.includes("if(key===S_KEY)vaultMark(null);"));
  ok(grabFn('vaultActive').includes('!(SRV.token&&!SRV.badAuth)'));
});
t('a device key never leaves the browser in plain view any more: devices join by wallet or one-time code', () => {
  ok(!html.includes('socCopyKey') && !html.includes('socUseKey'));
  ok(html.includes('id="socLinkNew"') && html.includes('id="socWalletLogin"') && html.includes('id="socLinkGo"'));
});

report('accounts');
