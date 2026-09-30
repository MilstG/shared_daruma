/* Vendored: Ethereum signature recovery (EIP-191 personal_sign) for Pulse wallet claims.
 * Bundled from @noble/curves 1.9.7 and @noble/hashes 1.8.0 (MIT, Paul Miller, audited) with esbuild;
 * the license notices of both are kept inline below. Source of the wrapper: the tail of this file.
 * Regenerate: npx esbuild entry.js --bundle --platform=node --format=cjs --target=node18 --legal-comments=inline */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/@noble/hashes/cryptoNode.js
var require_cryptoNode = __commonJS({
  "node_modules/@noble/hashes/cryptoNode.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.crypto = void 0;
    var nc = require("node:crypto");
    exports2.crypto = nc && typeof nc == "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc == "object" && "randomBytes" in nc ? nc : void 0;
  }
});

// node_modules/@noble/hashes/utils.js
var require_utils = __commonJS({
  "node_modules/@noble/hashes/utils.js"(exports2) {
    "use strict";
    /*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.wrapXOFConstructorWithOpts = exports2.wrapConstructorWithOpts = exports2.wrapConstructor = exports2.Hash = exports2.nextTick = exports2.swap32IfBE = exports2.byteSwapIfBE = exports2.swap8IfBE = exports2.isLE = void 0;
    exports2.isBytes = isBytes;
    exports2.anumber = anumber;
    exports2.abytes = abytes;
    exports2.ahash = ahash;
    exports2.aexists = aexists;
    exports2.aoutput = aoutput;
    exports2.u8 = u8;
    exports2.u32 = u32;
    exports2.clean = clean;
    exports2.createView = createView;
    exports2.rotr = rotr;
    exports2.rotl = rotl;
    exports2.byteSwap = byteSwap;
    exports2.byteSwap32 = byteSwap32;
    exports2.bytesToHex = bytesToHex;
    exports2.hexToBytes = hexToBytes;
    exports2.asyncLoop = asyncLoop;
    exports2.utf8ToBytes = utf8ToBytes;
    exports2.bytesToUtf8 = bytesToUtf8;
    exports2.toBytes = toBytes;
    exports2.kdfInputToBytes = kdfInputToBytes;
    exports2.concatBytes = concatBytes;
    exports2.checkOpts = checkOpts;
    exports2.createHasher = createHasher;
    exports2.createOptHasher = createOptHasher;
    exports2.createXOFer = createXOFer;
    exports2.randomBytes = randomBytes;
    var crypto_1 = require_cryptoNode();
    function isBytes(a) {
      return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
    }
    function anumber(n) {
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("positive integer expected, got " + n);
    }
    function abytes(b, ...lengths) {
      if (!isBytes(b))
        throw new Error("Uint8Array expected");
      if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
    }
    function ahash(h) {
      if (typeof h != "function" || typeof h.create != "function")
        throw new Error("Hash should be wrapped by utils.createHasher");
      anumber(h.outputLen), anumber(h.blockLen);
    }
    function aexists(instance, checkFinished = !0) {
      if (instance.destroyed)
        throw new Error("Hash instance has been destroyed");
      if (checkFinished && instance.finished)
        throw new Error("Hash#digest() has already been called");
    }
    function aoutput(out, instance) {
      abytes(out);
      let min = instance.outputLen;
      if (out.length < min)
        throw new Error("digestInto() expects output buffer of length at least " + min);
    }
    function u8(arr) {
      return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    function u32(arr) {
      return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
    }
    function clean(...arrays) {
      for (let i = 0; i < arrays.length; i++)
        arrays[i].fill(0);
    }
    function createView(arr) {
      return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    function rotr(word, shift) {
      return word << 32 - shift | word >>> shift;
    }
    function rotl(word, shift) {
      return word << shift | word >>> 32 - shift >>> 0;
    }
    exports2.isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
    function byteSwap(word) {
      return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
    }
    exports2.swap8IfBE = exports2.isLE ? (n) => n : (n) => byteSwap(n);
    exports2.byteSwapIfBE = exports2.swap8IfBE;
    function byteSwap32(arr) {
      for (let i = 0; i < arr.length; i++)
        arr[i] = byteSwap(arr[i]);
      return arr;
    }
    exports2.swap32IfBE = exports2.isLE ? (u) => u : byteSwap32;
    var hasHexBuiltin = /* @ts-ignore */ typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function", hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    function bytesToHex(bytes) {
      if (abytes(bytes), hasHexBuiltin)
        return bytes.toHex();
      let hex2 = "";
      for (let i = 0; i < bytes.length; i++)
        hex2 += hexes[bytes[i]];
      return hex2;
    }
    var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
    function asciiToBase16(ch) {
      if (ch >= asciis._0 && ch <= asciis._9)
        return ch - asciis._0;
      if (ch >= asciis.A && ch <= asciis.F)
        return ch - (asciis.A - 10);
      if (ch >= asciis.a && ch <= asciis.f)
        return ch - (asciis.a - 10);
    }
    function hexToBytes(hex2) {
      if (typeof hex2 != "string")
        throw new Error("hex string expected, got " + typeof hex2);
      if (hasHexBuiltin)
        return Uint8Array.fromHex(hex2);
      let hl = hex2.length, al = hl / 2;
      if (hl % 2)
        throw new Error("hex string expected, got unpadded hex of length " + hl);
      let array = new Uint8Array(al);
      for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        let n1 = asciiToBase16(hex2.charCodeAt(hi)), n2 = asciiToBase16(hex2.charCodeAt(hi + 1));
        if (n1 === void 0 || n2 === void 0) {
          let char = hex2[hi] + hex2[hi + 1];
          throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2;
      }
      return array;
    }
    var nextTick = async () => {
    };
    exports2.nextTick = nextTick;
    async function asyncLoop(iters, tick, cb) {
      let ts = Date.now();
      for (let i = 0; i < iters; i++) {
        cb(i);
        let diff = Date.now() - ts;
        diff >= 0 && diff < tick || (await (0, exports2.nextTick)(), ts += diff);
      }
    }
    function utf8ToBytes(str) {
      if (typeof str != "string")
        throw new Error("string expected");
      return new Uint8Array(new TextEncoder().encode(str));
    }
    function bytesToUtf8(bytes) {
      return new TextDecoder().decode(bytes);
    }
    function toBytes(data) {
      return typeof data == "string" && (data = utf8ToBytes(data)), abytes(data), data;
    }
    function kdfInputToBytes(data) {
      return typeof data == "string" && (data = utf8ToBytes(data)), abytes(data), data;
    }
    function concatBytes(...arrays) {
      let sum = 0;
      for (let i = 0; i < arrays.length; i++) {
        let a = arrays[i];
        abytes(a), sum += a.length;
      }
      let res = new Uint8Array(sum);
      for (let i = 0, pad = 0; i < arrays.length; i++) {
        let a = arrays[i];
        res.set(a, pad), pad += a.length;
      }
      return res;
    }
    function checkOpts(defaults, opts) {
      if (opts !== void 0 && {}.toString.call(opts) !== "[object Object]")
        throw new Error("options should be object or undefined");
      return Object.assign(defaults, opts);
    }
    var Hash = class {
    };
    exports2.Hash = Hash;
    function createHasher(hashCons) {
      let hashC = (msg) => hashCons().update(toBytes(msg)).digest(), tmp = hashCons();
      return hashC.outputLen = tmp.outputLen, hashC.blockLen = tmp.blockLen, hashC.create = () => hashCons(), hashC;
    }
    function createOptHasher(hashCons) {
      let hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest(), tmp = hashCons({});
      return hashC.outputLen = tmp.outputLen, hashC.blockLen = tmp.blockLen, hashC.create = (opts) => hashCons(opts), hashC;
    }
    function createXOFer(hashCons) {
      let hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest(), tmp = hashCons({});
      return hashC.outputLen = tmp.outputLen, hashC.blockLen = tmp.blockLen, hashC.create = (opts) => hashCons(opts), hashC;
    }
    exports2.wrapConstructor = createHasher;
    exports2.wrapConstructorWithOpts = createOptHasher;
    exports2.wrapXOFConstructorWithOpts = createXOFer;
    function randomBytes(bytesLength = 32) {
      if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues == "function")
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
      if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes == "function")
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
      throw new Error("crypto.getRandomValues must be defined");
    }
  }
});

// node_modules/@noble/hashes/_md.js
var require_md = __commonJS({
  "node_modules/@noble/hashes/_md.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.SHA512_IV = exports2.SHA384_IV = exports2.SHA224_IV = exports2.SHA256_IV = exports2.HashMD = void 0;
    exports2.setBigUint64 = setBigUint64;
    exports2.Chi = Chi;
    exports2.Maj = Maj;
    var utils_ts_1 = require_utils();
    function setBigUint64(view, byteOffset, value, isLE) {
      if (typeof view.setBigUint64 == "function")
        return view.setBigUint64(byteOffset, value, isLE);
      let _32n = BigInt(32), _u32_max = BigInt(4294967295), wh = Number(value >> _32n & _u32_max), wl = Number(value & _u32_max), h = isLE ? 4 : 0, l = isLE ? 0 : 4;
      view.setUint32(byteOffset + h, wh, isLE), view.setUint32(byteOffset + l, wl, isLE);
    }
    function Chi(a, b, c) {
      return a & b ^ ~a & c;
    }
    function Maj(a, b, c) {
      return a & b ^ a & c ^ b & c;
    }
    var HashMD = class extends utils_ts_1.Hash {
      constructor(blockLen, outputLen, padOffset, isLE) {
        super(), this.finished = !1, this.length = 0, this.pos = 0, this.destroyed = !1, this.blockLen = blockLen, this.outputLen = outputLen, this.padOffset = padOffset, this.isLE = isLE, this.buffer = new Uint8Array(blockLen), this.view = (0, utils_ts_1.createView)(this.buffer);
      }
      update(data) {
        (0, utils_ts_1.aexists)(this), data = (0, utils_ts_1.toBytes)(data), (0, utils_ts_1.abytes)(data);
        let { view, buffer, blockLen } = this, len = data.length;
        for (let pos = 0; pos < len; ) {
          let take = Math.min(blockLen - this.pos, len - pos);
          if (take === blockLen) {
            let dataView = (0, utils_ts_1.createView)(data);
            for (; blockLen <= len - pos; pos += blockLen)
              this.process(dataView, pos);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos), this.pos += take, pos += take, this.pos === blockLen && (this.process(view, 0), this.pos = 0);
        }
        return this.length += data.length, this.roundClean(), this;
      }
      digestInto(out) {
        (0, utils_ts_1.aexists)(this), (0, utils_ts_1.aoutput)(out, this), this.finished = !0;
        let { buffer, view, blockLen, isLE } = this, { pos } = this;
        buffer[pos++] = 128, (0, utils_ts_1.clean)(this.buffer.subarray(pos)), this.padOffset > blockLen - pos && (this.process(view, 0), pos = 0);
        for (let i = pos; i < blockLen; i++)
          buffer[i] = 0;
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE), this.process(view, 0);
        let oview = (0, utils_ts_1.createView)(out), len = this.outputLen;
        if (len % 4)
          throw new Error("_sha2: outputLen should be aligned to 32bit");
        let outLen = len / 4, state = this.get();
        if (outLen > state.length)
          throw new Error("_sha2: outputLen bigger than state");
        for (let i = 0; i < outLen; i++)
          oview.setUint32(4 * i, state[i], isLE);
      }
      digest() {
        let { buffer, outputLen } = this;
        this.digestInto(buffer);
        let res = buffer.slice(0, outputLen);
        return this.destroy(), res;
      }
      _cloneInto(to) {
        to || (to = new this.constructor()), to.set(...this.get());
        let { blockLen, buffer, length, finished, destroyed, pos } = this;
        return to.destroyed = destroyed, to.finished = finished, to.length = length, to.pos = pos, length % blockLen && to.buffer.set(buffer), to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    exports2.HashMD = HashMD;
    exports2.SHA256_IV = Uint32Array.from([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    exports2.SHA224_IV = Uint32Array.from([
      3238371032,
      914150663,
      812702999,
      4144912697,
      4290775857,
      1750603025,
      1694076839,
      3204075428
    ]);
    exports2.SHA384_IV = Uint32Array.from([
      3418070365,
      3238371032,
      1654270250,
      914150663,
      2438529370,
      812702999,
      355462360,
      4144912697,
      1731405415,
      4290775857,
      2394180231,
      1750603025,
      3675008525,
      1694076839,
      1203062813,
      3204075428
    ]);
    exports2.SHA512_IV = Uint32Array.from([
      1779033703,
      4089235720,
      3144134277,
      2227873595,
      1013904242,
      4271175723,
      2773480762,
      1595750129,
      1359893119,
      2917565137,
      2600822924,
      725511199,
      528734635,
      4215389547,
      1541459225,
      327033209
    ]);
  }
});

// node_modules/@noble/hashes/_u64.js
var require_u64 = __commonJS({
  "node_modules/@noble/hashes/_u64.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.toBig = exports2.shrSL = exports2.shrSH = exports2.rotrSL = exports2.rotrSH = exports2.rotrBL = exports2.rotrBH = exports2.rotr32L = exports2.rotr32H = exports2.rotlSL = exports2.rotlSH = exports2.rotlBL = exports2.rotlBH = exports2.add5L = exports2.add5H = exports2.add4L = exports2.add4H = exports2.add3L = exports2.add3H = void 0;
    exports2.add = add;
    exports2.fromBig = fromBig;
    exports2.split = split;
    var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1), _32n = /* @__PURE__ */ BigInt(32);
    function fromBig(n, le = !1) {
      return le ? { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) } : { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
    }
    function split(lst, le = !1) {
      let len = lst.length, Ah = new Uint32Array(len), Al = new Uint32Array(len);
      for (let i = 0; i < len; i++) {
        let { h, l } = fromBig(lst[i], le);
        [Ah[i], Al[i]] = [h, l];
      }
      return [Ah, Al];
    }
    var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0);
    exports2.toBig = toBig;
    var shrSH = (h, _l, s) => h >>> s;
    exports2.shrSH = shrSH;
    var shrSL = (h, l, s) => h << 32 - s | l >>> s;
    exports2.shrSL = shrSL;
    var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
    exports2.rotrSH = rotrSH;
    var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
    exports2.rotrSL = rotrSL;
    var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
    exports2.rotrBH = rotrBH;
    var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
    exports2.rotrBL = rotrBL;
    var rotr32H = (_h, l) => l;
    exports2.rotr32H = rotr32H;
    var rotr32L = (h, _l) => h;
    exports2.rotr32L = rotr32L;
    var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
    exports2.rotlSH = rotlSH;
    var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
    exports2.rotlSL = rotlSL;
    var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
    exports2.rotlBH = rotlBH;
    var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
    exports2.rotlBL = rotlBL;
    function add(Ah, Al, Bh, Bl) {
      let l = (Al >>> 0) + (Bl >>> 0);
      return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
    }
    var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
    exports2.add3L = add3L;
    var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
    exports2.add3H = add3H;
    var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
    exports2.add4L = add4L;
    var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
    exports2.add4H = add4H;
    var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
    exports2.add5L = add5L;
    var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
    exports2.add5H = add5H;
    var u64 = {
      fromBig,
      split,
      toBig,
      shrSH,
      shrSL,
      rotrSH,
      rotrSL,
      rotrBH,
      rotrBL,
      rotr32H,
      rotr32L,
      rotlSH,
      rotlSL,
      rotlBH,
      rotlBL,
      add,
      add3L,
      add3H,
      add4L,
      add4H,
      add5H,
      add5L
    };
    exports2.default = u64;
  }
});

// node_modules/@noble/hashes/sha2.js
var require_sha2 = __commonJS({
  "node_modules/@noble/hashes/sha2.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.sha512_224 = exports2.sha512_256 = exports2.sha384 = exports2.sha512 = exports2.sha224 = exports2.sha256 = exports2.SHA512_256 = exports2.SHA512_224 = exports2.SHA384 = exports2.SHA512 = exports2.SHA224 = exports2.SHA256 = void 0;
    var _md_ts_1 = require_md(), u64 = require_u64(), utils_ts_1 = require_utils(), SHA256_K = /* @__PURE__ */ Uint32Array.from([
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ]), SHA256_W = /* @__PURE__ */ new Uint32Array(64), SHA256 = class extends _md_ts_1.HashMD {
      constructor(outputLen = 32) {
        super(64, outputLen, 8, !1), this.A = _md_ts_1.SHA256_IV[0] | 0, this.B = _md_ts_1.SHA256_IV[1] | 0, this.C = _md_ts_1.SHA256_IV[2] | 0, this.D = _md_ts_1.SHA256_IV[3] | 0, this.E = _md_ts_1.SHA256_IV[4] | 0, this.F = _md_ts_1.SHA256_IV[5] | 0, this.G = _md_ts_1.SHA256_IV[6] | 0, this.H = _md_ts_1.SHA256_IV[7] | 0;
      }
      get() {
        let { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
      }
      // prettier-ignore
      set(A, B, C, D, E, F, G, H) {
        this.A = A | 0, this.B = B | 0, this.C = C | 0, this.D = D | 0, this.E = E | 0, this.F = F | 0, this.G = G | 0, this.H = H | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA256_W[i] = view.getUint32(offset, !1);
        for (let i = 16; i < 64; i++) {
          let W15 = SHA256_W[i - 15], W2 = SHA256_W[i - 2], s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ W15 >>> 3, s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ W2 >>> 10;
          SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
        }
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
          let sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25), T1 = H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0, T2 = ((0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22)) + (0, _md_ts_1.Maj)(A, B, C) | 0;
          H = G, G = F, F = E, E = D + T1 | 0, D = C, C = B, B = A, A = T1 + T2 | 0;
        }
        A = A + this.A | 0, B = B + this.B | 0, C = C + this.C | 0, D = D + this.D | 0, E = E + this.E | 0, F = F + this.F | 0, G = G + this.G | 0, H = H + this.H | 0, this.set(A, B, C, D, E, F, G, H);
      }
      roundClean() {
        (0, utils_ts_1.clean)(SHA256_W);
      }
      destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0), (0, utils_ts_1.clean)(this.buffer);
      }
    };
    exports2.SHA256 = SHA256;
    var SHA224 = class extends SHA256 {
      constructor() {
        super(28), this.A = _md_ts_1.SHA224_IV[0] | 0, this.B = _md_ts_1.SHA224_IV[1] | 0, this.C = _md_ts_1.SHA224_IV[2] | 0, this.D = _md_ts_1.SHA224_IV[3] | 0, this.E = _md_ts_1.SHA224_IV[4] | 0, this.F = _md_ts_1.SHA224_IV[5] | 0, this.G = _md_ts_1.SHA224_IV[6] | 0, this.H = _md_ts_1.SHA224_IV[7] | 0;
      }
    };
    exports2.SHA224 = SHA224;
    var K512 = u64.split([
      "0x428a2f98d728ae22",
      "0x7137449123ef65cd",
      "0xb5c0fbcfec4d3b2f",
      "0xe9b5dba58189dbbc",
      "0x3956c25bf348b538",
      "0x59f111f1b605d019",
      "0x923f82a4af194f9b",
      "0xab1c5ed5da6d8118",
      "0xd807aa98a3030242",
      "0x12835b0145706fbe",
      "0x243185be4ee4b28c",
      "0x550c7dc3d5ffb4e2",
      "0x72be5d74f27b896f",
      "0x80deb1fe3b1696b1",
      "0x9bdc06a725c71235",
      "0xc19bf174cf692694",
      "0xe49b69c19ef14ad2",
      "0xefbe4786384f25e3",
      "0x0fc19dc68b8cd5b5",
      "0x240ca1cc77ac9c65",
      "0x2de92c6f592b0275",
      "0x4a7484aa6ea6e483",
      "0x5cb0a9dcbd41fbd4",
      "0x76f988da831153b5",
      "0x983e5152ee66dfab",
      "0xa831c66d2db43210",
      "0xb00327c898fb213f",
      "0xbf597fc7beef0ee4",
      "0xc6e00bf33da88fc2",
      "0xd5a79147930aa725",
      "0x06ca6351e003826f",
      "0x142929670a0e6e70",
      "0x27b70a8546d22ffc",
      "0x2e1b21385c26c926",
      "0x4d2c6dfc5ac42aed",
      "0x53380d139d95b3df",
      "0x650a73548baf63de",
      "0x766a0abb3c77b2a8",
      "0x81c2c92e47edaee6",
      "0x92722c851482353b",
      "0xa2bfe8a14cf10364",
      "0xa81a664bbc423001",
      "0xc24b8b70d0f89791",
      "0xc76c51a30654be30",
      "0xd192e819d6ef5218",
      "0xd69906245565a910",
      "0xf40e35855771202a",
      "0x106aa07032bbd1b8",
      "0x19a4c116b8d2d0c8",
      "0x1e376c085141ab53",
      "0x2748774cdf8eeb99",
      "0x34b0bcb5e19b48a8",
      "0x391c0cb3c5c95a63",
      "0x4ed8aa4ae3418acb",
      "0x5b9cca4f7763e373",
      "0x682e6ff3d6b2b8a3",
      "0x748f82ee5defb2fc",
      "0x78a5636f43172f60",
      "0x84c87814a1f0ab72",
      "0x8cc702081a6439ec",
      "0x90befffa23631e28",
      "0xa4506cebde82bde9",
      "0xbef9a3f7b2c67915",
      "0xc67178f2e372532b",
      "0xca273eceea26619c",
      "0xd186b8c721c0c207",
      "0xeada7dd6cde0eb1e",
      "0xf57d4f7fee6ed178",
      "0x06f067aa72176fba",
      "0x0a637dc5a2c898a6",
      "0x113f9804bef90dae",
      "0x1b710b35131c471b",
      "0x28db77f523047d84",
      "0x32caab7b40c72493",
      "0x3c9ebe0a15c9bebc",
      "0x431d67c49c100d4c",
      "0x4cc5d4becb3e42b6",
      "0x597f299cfc657e2a",
      "0x5fcb6fab3ad6faec",
      "0x6c44198c4a475817"
    ].map((n) => BigInt(n))), SHA512_Kh = K512[0], SHA512_Kl = K512[1], SHA512_W_H = /* @__PURE__ */ new Uint32Array(80), SHA512_W_L = /* @__PURE__ */ new Uint32Array(80), SHA512 = class extends _md_ts_1.HashMD {
      constructor(outputLen = 64) {
        super(128, outputLen, 16, !1), this.Ah = _md_ts_1.SHA512_IV[0] | 0, this.Al = _md_ts_1.SHA512_IV[1] | 0, this.Bh = _md_ts_1.SHA512_IV[2] | 0, this.Bl = _md_ts_1.SHA512_IV[3] | 0, this.Ch = _md_ts_1.SHA512_IV[4] | 0, this.Cl = _md_ts_1.SHA512_IV[5] | 0, this.Dh = _md_ts_1.SHA512_IV[6] | 0, this.Dl = _md_ts_1.SHA512_IV[7] | 0, this.Eh = _md_ts_1.SHA512_IV[8] | 0, this.El = _md_ts_1.SHA512_IV[9] | 0, this.Fh = _md_ts_1.SHA512_IV[10] | 0, this.Fl = _md_ts_1.SHA512_IV[11] | 0, this.Gh = _md_ts_1.SHA512_IV[12] | 0, this.Gl = _md_ts_1.SHA512_IV[13] | 0, this.Hh = _md_ts_1.SHA512_IV[14] | 0, this.Hl = _md_ts_1.SHA512_IV[15] | 0;
      }
      // prettier-ignore
      get() {
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
      }
      // prettier-ignore
      set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0, this.Al = Al | 0, this.Bh = Bh | 0, this.Bl = Bl | 0, this.Ch = Ch | 0, this.Cl = Cl | 0, this.Dh = Dh | 0, this.Dl = Dl | 0, this.Eh = Eh | 0, this.El = El | 0, this.Fh = Fh | 0, this.Fl = Fl | 0, this.Gh = Gh | 0, this.Gl = Gl | 0, this.Hh = Hh | 0, this.Hl = Hl | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA512_W_H[i] = view.getUint32(offset), SHA512_W_L[i] = view.getUint32(offset += 4);
        for (let i = 16; i < 80; i++) {
          let W15h = SHA512_W_H[i - 15] | 0, W15l = SHA512_W_L[i - 15] | 0, s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7), s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7), W2h = SHA512_W_H[i - 2] | 0, W2l = SHA512_W_L[i - 2] | 0, s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6), s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6), SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]), SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
          SHA512_W_H[i] = SUMh | 0, SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        for (let i = 0; i < 80; i++) {
          let sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41), sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41), CHIh = Eh & Fh ^ ~Eh & Gh, CHIl = El & Fl ^ ~El & Gl, T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]), T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]), T1l = T1ll | 0, sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39), sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39), MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch, MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
          Hh = Gh | 0, Hl = Gl | 0, Gh = Fh | 0, Gl = Fl | 0, Fh = Eh | 0, Fl = El | 0, { h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0), Dh = Ch | 0, Dl = Cl | 0, Ch = Bh | 0, Cl = Bl | 0, Bh = Ah | 0, Bl = Al | 0;
          let All = u64.add3L(T1l, sigma0l, MAJl);
          Ah = u64.add3H(All, T1h, sigma0h, MAJh), Al = All | 0;
        }
        ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0)), { h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0), { h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0), { h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0), { h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0), { h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0), { h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0), { h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0), this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
      }
      roundClean() {
        (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
      }
      destroy() {
        (0, utils_ts_1.clean)(this.buffer), this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    };
    exports2.SHA512 = SHA512;
    var SHA384 = class extends SHA512 {
      constructor() {
        super(48), this.Ah = _md_ts_1.SHA384_IV[0] | 0, this.Al = _md_ts_1.SHA384_IV[1] | 0, this.Bh = _md_ts_1.SHA384_IV[2] | 0, this.Bl = _md_ts_1.SHA384_IV[3] | 0, this.Ch = _md_ts_1.SHA384_IV[4] | 0, this.Cl = _md_ts_1.SHA384_IV[5] | 0, this.Dh = _md_ts_1.SHA384_IV[6] | 0, this.Dl = _md_ts_1.SHA384_IV[7] | 0, this.Eh = _md_ts_1.SHA384_IV[8] | 0, this.El = _md_ts_1.SHA384_IV[9] | 0, this.Fh = _md_ts_1.SHA384_IV[10] | 0, this.Fl = _md_ts_1.SHA384_IV[11] | 0, this.Gh = _md_ts_1.SHA384_IV[12] | 0, this.Gl = _md_ts_1.SHA384_IV[13] | 0, this.Hh = _md_ts_1.SHA384_IV[14] | 0, this.Hl = _md_ts_1.SHA384_IV[15] | 0;
      }
    };
    exports2.SHA384 = SHA384;
    var T224_IV = /* @__PURE__ */ Uint32Array.from([
      2352822216,
      424955298,
      1944164710,
      2312950998,
      502970286,
      855612546,
      1738396948,
      1479516111,
      258812777,
      2077511080,
      2011393907,
      79989058,
      1067287976,
      1780299464,
      286451373,
      2446758561
    ]), T256_IV = /* @__PURE__ */ Uint32Array.from([
      573645204,
      4230739756,
      2673172387,
      3360449730,
      596883563,
      1867755857,
      2520282905,
      1497426621,
      2519219938,
      2827943907,
      3193839141,
      1401305490,
      721525244,
      746961066,
      246885852,
      2177182882
    ]), SHA512_224 = class extends SHA512 {
      constructor() {
        super(28), this.Ah = T224_IV[0] | 0, this.Al = T224_IV[1] | 0, this.Bh = T224_IV[2] | 0, this.Bl = T224_IV[3] | 0, this.Ch = T224_IV[4] | 0, this.Cl = T224_IV[5] | 0, this.Dh = T224_IV[6] | 0, this.Dl = T224_IV[7] | 0, this.Eh = T224_IV[8] | 0, this.El = T224_IV[9] | 0, this.Fh = T224_IV[10] | 0, this.Fl = T224_IV[11] | 0, this.Gh = T224_IV[12] | 0, this.Gl = T224_IV[13] | 0, this.Hh = T224_IV[14] | 0, this.Hl = T224_IV[15] | 0;
      }
    };
    exports2.SHA512_224 = SHA512_224;
    var SHA512_256 = class extends SHA512 {
      constructor() {
        super(32), this.Ah = T256_IV[0] | 0, this.Al = T256_IV[1] | 0, this.Bh = T256_IV[2] | 0, this.Bl = T256_IV[3] | 0, this.Ch = T256_IV[4] | 0, this.Cl = T256_IV[5] | 0, this.Dh = T256_IV[6] | 0, this.Dl = T256_IV[7] | 0, this.Eh = T256_IV[8] | 0, this.El = T256_IV[9] | 0, this.Fh = T256_IV[10] | 0, this.Fl = T256_IV[11] | 0, this.Gh = T256_IV[12] | 0, this.Gl = T256_IV[13] | 0, this.Hh = T256_IV[14] | 0, this.Hl = T256_IV[15] | 0;
      }
    };
    exports2.SHA512_256 = SHA512_256;
    exports2.sha256 = (0, utils_ts_1.createHasher)(() => new SHA256());
    exports2.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224());
    exports2.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512());
    exports2.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384());
    exports2.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256());
    exports2.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224());
  }
});

// node_modules/@noble/hashes/hmac.js
var require_hmac = __commonJS({
  "node_modules/@noble/hashes/hmac.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.hmac = exports2.HMAC = void 0;
    var utils_ts_1 = require_utils(), HMAC = class extends utils_ts_1.Hash {
      constructor(hash, _key) {
        super(), this.finished = !1, this.destroyed = !1, (0, utils_ts_1.ahash)(hash);
        let key = (0, utils_ts_1.toBytes)(_key);
        if (this.iHash = hash.create(), typeof this.iHash.update != "function")
          throw new Error("Expected instance of class which extends utils.Hash");
        this.blockLen = this.iHash.blockLen, this.outputLen = this.iHash.outputLen;
        let blockLen = this.blockLen, pad = new Uint8Array(blockLen);
        pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 54;
        this.iHash.update(pad), this.oHash = hash.create();
        for (let i = 0; i < pad.length; i++)
          pad[i] ^= 106;
        this.oHash.update(pad), (0, utils_ts_1.clean)(pad);
      }
      update(buf) {
        return (0, utils_ts_1.aexists)(this), this.iHash.update(buf), this;
      }
      digestInto(out) {
        (0, utils_ts_1.aexists)(this), (0, utils_ts_1.abytes)(out, this.outputLen), this.finished = !0, this.iHash.digestInto(out), this.oHash.update(out), this.oHash.digestInto(out), this.destroy();
      }
      digest() {
        let out = new Uint8Array(this.oHash.outputLen);
        return this.digestInto(out), out;
      }
      _cloneInto(to) {
        to || (to = Object.create(Object.getPrototypeOf(this), {}));
        let { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
        return to = to, to.finished = finished, to.destroyed = destroyed, to.blockLen = blockLen, to.outputLen = outputLen, to.oHash = oHash._cloneInto(to.oHash), to.iHash = iHash._cloneInto(to.iHash), to;
      }
      clone() {
        return this._cloneInto();
      }
      destroy() {
        this.destroyed = !0, this.oHash.destroy(), this.iHash.destroy();
      }
    };
    exports2.HMAC = HMAC;
    var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
    exports2.hmac = hmac;
    exports2.hmac.create = (hash, key) => new HMAC(hash, key);
  }
});

// node_modules/@noble/curves/utils.js
var require_utils2 = __commonJS({
  "node_modules/@noble/curves/utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.notImplemented = exports2.bitMask = exports2.utf8ToBytes = exports2.randomBytes = exports2.isBytes = exports2.hexToBytes = exports2.concatBytes = exports2.bytesToUtf8 = exports2.bytesToHex = exports2.anumber = exports2.abytes = void 0;
    exports2.abool = abool;
    exports2._abool2 = _abool2;
    exports2._abytes2 = _abytes2;
    exports2.numberToHexUnpadded = numberToHexUnpadded;
    exports2.hexToNumber = hexToNumber;
    exports2.bytesToNumberBE = bytesToNumberBE;
    exports2.bytesToNumberLE = bytesToNumberLE;
    exports2.numberToBytesBE = numberToBytesBE;
    exports2.numberToBytesLE = numberToBytesLE;
    exports2.numberToVarBytesBE = numberToVarBytesBE;
    exports2.ensureBytes = ensureBytes;
    exports2.equalBytes = equalBytes;
    exports2.copyBytes = copyBytes;
    exports2.asciiToBytes = asciiToBytes;
    exports2.inRange = inRange;
    exports2.aInRange = aInRange;
    exports2.bitLen = bitLen;
    exports2.bitGet = bitGet;
    exports2.bitSet = bitSet;
    exports2.createHmacDrbg = createHmacDrbg;
    exports2.validateObject = validateObject;
    exports2.isHash = isHash;
    exports2._validateObject = _validateObject;
    exports2.memoized = memoized;
    /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    var utils_js_1 = require_utils(), utils_js_2 = require_utils();
    Object.defineProperty(exports2, "abytes", { enumerable: !0, get: function() {
      return utils_js_2.abytes;
    } });
    Object.defineProperty(exports2, "anumber", { enumerable: !0, get: function() {
      return utils_js_2.anumber;
    } });
    Object.defineProperty(exports2, "bytesToHex", { enumerable: !0, get: function() {
      return utils_js_2.bytesToHex;
    } });
    Object.defineProperty(exports2, "bytesToUtf8", { enumerable: !0, get: function() {
      return utils_js_2.bytesToUtf8;
    } });
    Object.defineProperty(exports2, "concatBytes", { enumerable: !0, get: function() {
      return utils_js_2.concatBytes;
    } });
    Object.defineProperty(exports2, "hexToBytes", { enumerable: !0, get: function() {
      return utils_js_2.hexToBytes;
    } });
    Object.defineProperty(exports2, "isBytes", { enumerable: !0, get: function() {
      return utils_js_2.isBytes;
    } });
    Object.defineProperty(exports2, "randomBytes", { enumerable: !0, get: function() {
      return utils_js_2.randomBytes;
    } });
    Object.defineProperty(exports2, "utf8ToBytes", { enumerable: !0, get: function() {
      return utils_js_2.utf8ToBytes;
    } });
    var _0n = /* @__PURE__ */ BigInt(0), _1n = /* @__PURE__ */ BigInt(1);
    function abool(title, value) {
      if (typeof value != "boolean")
        throw new Error(title + " boolean expected, got " + value);
    }
    function _abool2(value, title = "") {
      if (typeof value != "boolean") {
        let prefix = title && `"${title}"`;
        throw new Error(prefix + "expected boolean, got type=" + typeof value);
      }
      return value;
    }
    function _abytes2(value, length, title = "") {
      let bytes = (0, utils_js_1.isBytes)(value), len = value?.length, needsLen = length !== void 0;
      if (!bytes || needsLen && len !== length) {
        let prefix = title && `"${title}" `, ofLen = needsLen ? ` of length ${length}` : "", got = bytes ? `length=${len}` : `type=${typeof value}`;
        throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
      }
      return value;
    }
    function numberToHexUnpadded(num) {
      let hex2 = num.toString(16);
      return hex2.length & 1 ? "0" + hex2 : hex2;
    }
    function hexToNumber(hex2) {
      if (typeof hex2 != "string")
        throw new Error("hex string expected, got " + typeof hex2);
      return hex2 === "" ? _0n : BigInt("0x" + hex2);
    }
    function bytesToNumberBE(bytes) {
      return hexToNumber((0, utils_js_1.bytesToHex)(bytes));
    }
    function bytesToNumberLE(bytes) {
      return (0, utils_js_1.abytes)(bytes), hexToNumber((0, utils_js_1.bytesToHex)(Uint8Array.from(bytes).reverse()));
    }
    function numberToBytesBE(n, len) {
      return (0, utils_js_1.hexToBytes)(n.toString(16).padStart(len * 2, "0"));
    }
    function numberToBytesLE(n, len) {
      return numberToBytesBE(n, len).reverse();
    }
    function numberToVarBytesBE(n) {
      return (0, utils_js_1.hexToBytes)(numberToHexUnpadded(n));
    }
    function ensureBytes(title, hex2, expectedLength) {
      let res;
      if (typeof hex2 == "string")
        try {
          res = (0, utils_js_1.hexToBytes)(hex2);
        } catch (e) {
          throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
        }
      else if ((0, utils_js_1.isBytes)(hex2))
        res = Uint8Array.from(hex2);
      else
        throw new Error(title + " must be hex string or Uint8Array");
      let len = res.length;
      if (typeof expectedLength == "number" && len !== expectedLength)
        throw new Error(title + " of length " + expectedLength + " expected, got " + len);
      return res;
    }
    function equalBytes(a, b) {
      if (a.length !== b.length)
        return !1;
      let diff = 0;
      for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
      return diff === 0;
    }
    function copyBytes(bytes) {
      return Uint8Array.from(bytes);
    }
    function asciiToBytes(ascii) {
      return Uint8Array.from(ascii, (c, i) => {
        let charCode = c.charCodeAt(0);
        if (c.length !== 1 || charCode > 127)
          throw new Error(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
        return charCode;
      });
    }
    var isPosBig = (n) => typeof n == "bigint" && _0n <= n;
    function inRange(n, min, max) {
      return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
    }
    function aInRange(title, n, min, max) {
      if (!inRange(n, min, max))
        throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
    }
    function bitLen(n) {
      let len;
      for (len = 0; n > _0n; n >>= _1n, len += 1)
        ;
      return len;
    }
    function bitGet(n, pos) {
      return n >> BigInt(pos) & _1n;
    }
    function bitSet(n, pos, value) {
      return n | (value ? _1n : _0n) << BigInt(pos);
    }
    var bitMask = (n) => (_1n << BigInt(n)) - _1n;
    exports2.bitMask = bitMask;
    function createHmacDrbg(hashLen, qByteLen, hmacFn) {
      if (typeof hashLen != "number" || hashLen < 2)
        throw new Error("hashLen must be a number");
      if (typeof qByteLen != "number" || qByteLen < 2)
        throw new Error("qByteLen must be a number");
      if (typeof hmacFn != "function")
        throw new Error("hmacFn must be a function");
      let u8n = (len) => new Uint8Array(len), u8of = (byte) => Uint8Array.of(byte), v = u8n(hashLen), k = u8n(hashLen), i = 0, reset = () => {
        v.fill(1), k.fill(0), i = 0;
      }, h = (...b) => hmacFn(k, v, ...b), reseed = (seed = u8n(0)) => {
        k = h(u8of(0), seed), v = h(), seed.length !== 0 && (k = h(u8of(1), seed), v = h());
      }, gen = () => {
        if (i++ >= 1e3)
          throw new Error("drbg: tried 1000 values");
        let len = 0, out = [];
        for (; len < qByteLen; ) {
          v = h();
          let sl = v.slice();
          out.push(sl), len += v.length;
        }
        return (0, utils_js_1.concatBytes)(...out);
      };
      return (seed, pred) => {
        reset(), reseed(seed);
        let res;
        for (; !(res = pred(gen())); )
          reseed();
        return reset(), res;
      };
    }
    var validatorFns = {
      bigint: (val) => typeof val == "bigint",
      function: (val) => typeof val == "function",
      boolean: (val) => typeof val == "boolean",
      string: (val) => typeof val == "string",
      stringOrUint8Array: (val) => typeof val == "string" || (0, utils_js_1.isBytes)(val),
      isSafeInteger: (val) => Number.isSafeInteger(val),
      array: (val) => Array.isArray(val),
      field: (val, object) => object.Fp.isValid(val),
      hash: (val) => typeof val == "function" && Number.isSafeInteger(val.outputLen)
    };
    function validateObject(object, validators, optValidators = {}) {
      let checkField = (fieldName, type, isOptional) => {
        let checkVal = validatorFns[type];
        if (typeof checkVal != "function")
          throw new Error("invalid validator function");
        let val = object[fieldName];
        if (!(isOptional && val === void 0) && !checkVal(val, object))
          throw new Error("param " + String(fieldName) + " is invalid. Expected " + type + ", got " + val);
      };
      for (let [fieldName, type] of Object.entries(validators))
        checkField(fieldName, type, !1);
      for (let [fieldName, type] of Object.entries(optValidators))
        checkField(fieldName, type, !0);
      return object;
    }
    function isHash(val) {
      return typeof val == "function" && Number.isSafeInteger(val.outputLen);
    }
    function _validateObject(object, fields, optFields = {}) {
      if (!object || typeof object != "object")
        throw new Error("expected valid options object");
      function checkField(fieldName, expectedType, isOpt) {
        let val = object[fieldName];
        if (isOpt && val === void 0)
          return;
        let current = typeof val;
        if (current !== expectedType || val === null)
          throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
      }
      Object.entries(fields).forEach(([k, v]) => checkField(k, v, !1)), Object.entries(optFields).forEach(([k, v]) => checkField(k, v, !0));
    }
    var notImplemented = () => {
      throw new Error("not implemented");
    };
    exports2.notImplemented = notImplemented;
    function memoized(fn) {
      let map = /* @__PURE__ */ new WeakMap();
      return (arg, ...args) => {
        let val = map.get(arg);
        if (val !== void 0)
          return val;
        let computed = fn(arg, ...args);
        return map.set(arg, computed), computed;
      };
    }
  }
});

// node_modules/@noble/curves/abstract/modular.js
var require_modular = __commonJS({
  "node_modules/@noble/curves/abstract/modular.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.isNegativeLE = void 0;
    exports2.mod = mod;
    exports2.pow = pow;
    exports2.pow2 = pow2;
    exports2.invert = invert;
    exports2.tonelliShanks = tonelliShanks;
    exports2.FpSqrt = FpSqrt;
    exports2.validateField = validateField;
    exports2.FpPow = FpPow;
    exports2.FpInvertBatch = FpInvertBatch;
    exports2.FpDiv = FpDiv;
    exports2.FpLegendre = FpLegendre;
    exports2.FpIsSquare = FpIsSquare;
    exports2.nLength = nLength;
    exports2.Field = Field;
    exports2.FpSqrtOdd = FpSqrtOdd;
    exports2.FpSqrtEven = FpSqrtEven;
    exports2.hashToPrivateScalar = hashToPrivateScalar;
    exports2.getFieldBytesLength = getFieldBytesLength;
    exports2.getMinHashLength = getMinHashLength;
    exports2.mapHashToField = mapHashToField;
    /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    var utils_ts_1 = require_utils2(), _0n = BigInt(0), _1n = BigInt(1), _2n = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3), _4n = /* @__PURE__ */ BigInt(4), _5n = /* @__PURE__ */ BigInt(5), _7n = /* @__PURE__ */ BigInt(7), _8n = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9), _16n = /* @__PURE__ */ BigInt(16);
    function mod(a, b) {
      let result = a % b;
      return result >= _0n ? result : b + result;
    }
    function pow(num, power, modulo) {
      return FpPow(Field(modulo), num, power);
    }
    function pow2(x, power, modulo) {
      let res = x;
      for (; power-- > _0n; )
        res *= res, res %= modulo;
      return res;
    }
    function invert(number, modulo) {
      if (number === _0n)
        throw new Error("invert: expected non-zero number");
      if (modulo <= _0n)
        throw new Error("invert: expected positive modulus, got " + modulo);
      let a = mod(number, modulo), b = modulo, x = _0n, y = _1n, u = _1n, v = _0n;
      for (; a !== _0n; ) {
        let q = b / a, r = b % a, m = x - u * q, n = y - v * q;
        b = a, a = r, x = u, y = v, u = m, v = n;
      }
      if (b !== _1n)
        throw new Error("invert: does not exist");
      return mod(x, modulo);
    }
    function assertIsSquare(Fp, root, n) {
      if (!Fp.eql(Fp.sqr(root), n))
        throw new Error("Cannot find square root");
    }
    function sqrt3mod4(Fp, n) {
      let p1div4 = (Fp.ORDER + _1n) / _4n, root = Fp.pow(n, p1div4);
      return assertIsSquare(Fp, root, n), root;
    }
    function sqrt5mod8(Fp, n) {
      let p5div8 = (Fp.ORDER - _5n) / _8n, n2 = Fp.mul(n, _2n), v = Fp.pow(n2, p5div8), nv = Fp.mul(n, v), i = Fp.mul(Fp.mul(nv, _2n), v), root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
      return assertIsSquare(Fp, root, n), root;
    }
    function sqrt9mod16(P) {
      let Fp_ = Field(P), tn = tonelliShanks(P), c1 = tn(Fp_, Fp_.neg(Fp_.ONE)), c2 = tn(Fp_, c1), c3 = tn(Fp_, Fp_.neg(c1)), c4 = (P + _7n) / _16n;
      return (Fp, n) => {
        let tv1 = Fp.pow(n, c4), tv2 = Fp.mul(tv1, c1), tv3 = Fp.mul(tv1, c2), tv4 = Fp.mul(tv1, c3), e1 = Fp.eql(Fp.sqr(tv2), n), e2 = Fp.eql(Fp.sqr(tv3), n);
        tv1 = Fp.cmov(tv1, tv2, e1), tv2 = Fp.cmov(tv4, tv3, e2);
        let e3 = Fp.eql(Fp.sqr(tv2), n), root = Fp.cmov(tv1, tv2, e3);
        return assertIsSquare(Fp, root, n), root;
      };
    }
    function tonelliShanks(P) {
      if (P < _3n)
        throw new Error("sqrt is not defined for small field");
      let Q = P - _1n, S = 0;
      for (; Q % _2n === _0n; )
        Q /= _2n, S++;
      let Z = _2n, _Fp = Field(P);
      for (; FpLegendre(_Fp, Z) === 1; )
        if (Z++ > 1e3)
          throw new Error("Cannot find square root: probably non-prime P");
      if (S === 1)
        return sqrt3mod4;
      let cc = _Fp.pow(Z, Q), Q1div2 = (Q + _1n) / _2n;
      return function(Fp, n) {
        if (Fp.is0(n))
          return n;
        if (FpLegendre(Fp, n) !== 1)
          throw new Error("Cannot find square root");
        let M = S, c = Fp.mul(Fp.ONE, cc), t = Fp.pow(n, Q), R = Fp.pow(n, Q1div2);
        for (; !Fp.eql(t, Fp.ONE); ) {
          if (Fp.is0(t))
            return Fp.ZERO;
          let i = 1, t_tmp = Fp.sqr(t);
          for (; !Fp.eql(t_tmp, Fp.ONE); )
            if (i++, t_tmp = Fp.sqr(t_tmp), i === M)
              throw new Error("Cannot find square root");
          let exponent = _1n << BigInt(M - i - 1), b = Fp.pow(c, exponent);
          M = i, c = Fp.sqr(b), t = Fp.mul(t, c), R = Fp.mul(R, b);
        }
        return R;
      };
    }
    function FpSqrt(P) {
      return P % _4n === _3n ? sqrt3mod4 : P % _8n === _5n ? sqrt5mod8 : P % _16n === _9n ? sqrt9mod16(P) : tonelliShanks(P);
    }
    var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n) === _1n;
    exports2.isNegativeLE = isNegativeLE;
    var FIELD_FIELDS = [
      "create",
      "isValid",
      "is0",
      "neg",
      "inv",
      "sqrt",
      "sqr",
      "eql",
      "add",
      "sub",
      "mul",
      "pow",
      "div",
      "addN",
      "subN",
      "mulN",
      "sqrN"
    ];
    function validateField(field) {
      let initial = {
        ORDER: "bigint",
        MASK: "bigint",
        BYTES: "number",
        BITS: "number"
      }, opts = FIELD_FIELDS.reduce((map, val) => (map[val] = "function", map), initial);
      return (0, utils_ts_1._validateObject)(field, opts), field;
    }
    function FpPow(Fp, num, power) {
      if (power < _0n)
        throw new Error("invalid exponent, negatives unsupported");
      if (power === _0n)
        return Fp.ONE;
      if (power === _1n)
        return num;
      let p = Fp.ONE, d = num;
      for (; power > _0n; )
        power & _1n && (p = Fp.mul(p, d)), d = Fp.sqr(d), power >>= _1n;
      return p;
    }
    function FpInvertBatch(Fp, nums, passZero = !1) {
      let inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : void 0), multipliedAcc = nums.reduce((acc, num, i) => Fp.is0(num) ? acc : (inverted[i] = acc, Fp.mul(acc, num)), Fp.ONE), invertedAcc = Fp.inv(multipliedAcc);
      return nums.reduceRight((acc, num, i) => Fp.is0(num) ? acc : (inverted[i] = Fp.mul(acc, inverted[i]), Fp.mul(acc, num)), invertedAcc), inverted;
    }
    function FpDiv(Fp, lhs, rhs) {
      return Fp.mul(lhs, typeof rhs == "bigint" ? invert(rhs, Fp.ORDER) : Fp.inv(rhs));
    }
    function FpLegendre(Fp, n) {
      let p1mod2 = (Fp.ORDER - _1n) / _2n, powered = Fp.pow(n, p1mod2), yes = Fp.eql(powered, Fp.ONE), zero = Fp.eql(powered, Fp.ZERO), no = Fp.eql(powered, Fp.neg(Fp.ONE));
      if (!yes && !zero && !no)
        throw new Error("invalid Legendre symbol result");
      return yes ? 1 : zero ? 0 : -1;
    }
    function FpIsSquare(Fp, n) {
      return FpLegendre(Fp, n) === 1;
    }
    function nLength(n, nBitLength) {
      nBitLength !== void 0 && (0, utils_ts_1.anumber)(nBitLength);
      let _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length, nByteLength = Math.ceil(_nBitLength / 8);
      return { nBitLength: _nBitLength, nByteLength };
    }
    function Field(ORDER, bitLenOrOpts, isLE = !1, opts = {}) {
      if (ORDER <= _0n)
        throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
      let _nbitLength, _sqrt, modFromBytes = !1, allowedLengths;
      if (typeof bitLenOrOpts == "object" && bitLenOrOpts != null) {
        if (opts.sqrt || isLE)
          throw new Error("cannot specify opts in two arguments");
        let _opts = bitLenOrOpts;
        _opts.BITS && (_nbitLength = _opts.BITS), _opts.sqrt && (_sqrt = _opts.sqrt), typeof _opts.isLE == "boolean" && (isLE = _opts.isLE), typeof _opts.modFromBytes == "boolean" && (modFromBytes = _opts.modFromBytes), allowedLengths = _opts.allowedLengths;
      } else
        typeof bitLenOrOpts == "number" && (_nbitLength = bitLenOrOpts), opts.sqrt && (_sqrt = opts.sqrt);
      let { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
      if (BYTES > 2048)
        throw new Error("invalid field: expected ORDER of <= 2048 bytes");
      let sqrtP, f = Object.freeze({
        ORDER,
        isLE,
        BITS,
        BYTES,
        MASK: (0, utils_ts_1.bitMask)(BITS),
        ZERO: _0n,
        ONE: _1n,
        allowedLengths,
        create: (num) => mod(num, ORDER),
        isValid: (num) => {
          if (typeof num != "bigint")
            throw new Error("invalid field element: expected bigint, got " + typeof num);
          return _0n <= num && num < ORDER;
        },
        is0: (num) => num === _0n,
        // is valid and invertible
        isValidNot0: (num) => !f.is0(num) && f.isValid(num),
        isOdd: (num) => (num & _1n) === _1n,
        neg: (num) => mod(-num, ORDER),
        eql: (lhs, rhs) => lhs === rhs,
        sqr: (num) => mod(num * num, ORDER),
        add: (lhs, rhs) => mod(lhs + rhs, ORDER),
        sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
        mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
        pow: (num, power) => FpPow(f, num, power),
        div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
        // Same as above, but doesn't normalize
        sqrN: (num) => num * num,
        addN: (lhs, rhs) => lhs + rhs,
        subN: (lhs, rhs) => lhs - rhs,
        mulN: (lhs, rhs) => lhs * rhs,
        inv: (num) => invert(num, ORDER),
        sqrt: _sqrt || ((n) => (sqrtP || (sqrtP = FpSqrt(ORDER)), sqrtP(f, n))),
        toBytes: (num) => isLE ? (0, utils_ts_1.numberToBytesLE)(num, BYTES) : (0, utils_ts_1.numberToBytesBE)(num, BYTES),
        fromBytes: (bytes, skipValidation = !0) => {
          if (allowedLengths) {
            if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES)
              throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
            let padded = new Uint8Array(BYTES);
            padded.set(bytes, isLE ? 0 : padded.length - bytes.length), bytes = padded;
          }
          if (bytes.length !== BYTES)
            throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
          let scalar = isLE ? (0, utils_ts_1.bytesToNumberLE)(bytes) : (0, utils_ts_1.bytesToNumberBE)(bytes);
          if (modFromBytes && (scalar = mod(scalar, ORDER)), !skipValidation && !f.isValid(scalar))
            throw new Error("invalid field element: outside of range 0..ORDER");
          return scalar;
        },
        // TODO: we don't need it here, move out to separate fn
        invertBatch: (lst) => FpInvertBatch(f, lst),
        // We can't move this out because Fp6, Fp12 implement it
        // and it's unclear what to return in there.
        cmov: (a, b, c) => c ? b : a
      });
      return Object.freeze(f);
    }
    function FpSqrtOdd(Fp, elm) {
      if (!Fp.isOdd)
        throw new Error("Field doesn't have isOdd");
      let root = Fp.sqrt(elm);
      return Fp.isOdd(root) ? root : Fp.neg(root);
    }
    function FpSqrtEven(Fp, elm) {
      if (!Fp.isOdd)
        throw new Error("Field doesn't have isOdd");
      let root = Fp.sqrt(elm);
      return Fp.isOdd(root) ? Fp.neg(root) : root;
    }
    function hashToPrivateScalar(hash, groupOrder, isLE = !1) {
      hash = (0, utils_ts_1.ensureBytes)("privateHash", hash);
      let hashLen = hash.length, minLen = nLength(groupOrder).nByteLength + 8;
      if (minLen < 24 || hashLen < minLen || hashLen > 1024)
        throw new Error("hashToPrivateScalar: expected " + minLen + "-1024 bytes of input, got " + hashLen);
      let num = isLE ? (0, utils_ts_1.bytesToNumberLE)(hash) : (0, utils_ts_1.bytesToNumberBE)(hash);
      return mod(num, groupOrder - _1n) + _1n;
    }
    function getFieldBytesLength(fieldOrder) {
      if (typeof fieldOrder != "bigint")
        throw new Error("field order must be bigint");
      let bitLength = fieldOrder.toString(2).length;
      return Math.ceil(bitLength / 8);
    }
    function getMinHashLength(fieldOrder) {
      let length = getFieldBytesLength(fieldOrder);
      return length + Math.ceil(length / 2);
    }
    function mapHashToField(key, fieldOrder, isLE = !1) {
      let len = key.length, fieldLen = getFieldBytesLength(fieldOrder), minLen = getMinHashLength(fieldOrder);
      if (len < 16 || len < minLen || len > 1024)
        throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
      let num = isLE ? (0, utils_ts_1.bytesToNumberLE)(key) : (0, utils_ts_1.bytesToNumberBE)(key), reduced = mod(num, fieldOrder - _1n) + _1n;
      return isLE ? (0, utils_ts_1.numberToBytesLE)(reduced, fieldLen) : (0, utils_ts_1.numberToBytesBE)(reduced, fieldLen);
    }
  }
});

// node_modules/@noble/curves/abstract/curve.js
var require_curve = __commonJS({
  "node_modules/@noble/curves/abstract/curve.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.wNAF = void 0;
    exports2.negateCt = negateCt;
    exports2.normalizeZ = normalizeZ;
    exports2.mulEndoUnsafe = mulEndoUnsafe;
    exports2.pippenger = pippenger;
    exports2.precomputeMSMUnsafe = precomputeMSMUnsafe;
    exports2.validateBasic = validateBasic;
    exports2._createCurveFields = _createCurveFields;
    /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    var utils_ts_1 = require_utils2(), modular_ts_1 = require_modular(), _0n = BigInt(0), _1n = BigInt(1);
    function negateCt(condition, item) {
      let neg = item.negate();
      return condition ? neg : item;
    }
    function normalizeZ(c, points) {
      let invertedZs = (0, modular_ts_1.FpInvertBatch)(c.Fp, points.map((p) => p.Z));
      return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
    }
    function validateW(W, bits) {
      if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
        throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
    }
    function calcWOpts(W, scalarBits) {
      validateW(W, scalarBits);
      let windows = Math.ceil(scalarBits / W) + 1, windowSize = 2 ** (W - 1), maxNumber = 2 ** W, mask = (0, utils_ts_1.bitMask)(W), shiftBy = BigInt(W);
      return { windows, windowSize, mask, maxNumber, shiftBy };
    }
    function calcOffsets(n, window, wOpts) {
      let { windowSize, mask, maxNumber, shiftBy } = wOpts, wbits = Number(n & mask), nextN = n >> shiftBy;
      wbits > windowSize && (wbits -= maxNumber, nextN += _1n);
      let offsetStart = window * windowSize, offset = offsetStart + Math.abs(wbits) - 1, isZero = wbits === 0, isNeg = wbits < 0, isNegF = window % 2 !== 0;
      return { nextN, offset, isZero, isNeg, isNegF, offsetF: offsetStart };
    }
    function validateMSMPoints(points, c) {
      if (!Array.isArray(points))
        throw new Error("array expected");
      points.forEach((p, i) => {
        if (!(p instanceof c))
          throw new Error("invalid point at index " + i);
      });
    }
    function validateMSMScalars(scalars, field) {
      if (!Array.isArray(scalars))
        throw new Error("array of scalars expected");
      scalars.forEach((s, i) => {
        if (!field.isValid(s))
          throw new Error("invalid scalar at index " + i);
      });
    }
    var pointPrecomputes = /* @__PURE__ */ new WeakMap(), pointWindowSizes = /* @__PURE__ */ new WeakMap();
    function getW(P) {
      return pointWindowSizes.get(P) || 1;
    }
    function assert0(n) {
      if (n !== _0n)
        throw new Error("invalid wNAF");
    }
    var wNAF = class {
      // Parametrized with a given Point class (not individual point)
      constructor(Point, bits) {
        this.BASE = Point.BASE, this.ZERO = Point.ZERO, this.Fn = Point.Fn, this.bits = bits;
      }
      // non-const time multiplication ladder
      _unsafeLadder(elm, n, p = this.ZERO) {
        let d = elm;
        for (; n > _0n; )
          n & _1n && (p = p.add(d)), d = d.double(), n >>= _1n;
        return p;
      }
      /**
       * Creates a wNAF precomputation window. Used for caching.
       * Default window size is set by `utils.precompute()` and is equal to 8.
       * Number of precomputed points depends on the curve size:
       * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
       * - 𝑊 is the window size
       * - 𝑛 is the bitlength of the curve order.
       * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
       * @param point Point instance
       * @param W window size
       * @returns precomputed point tables flattened to a single array
       */
      precomputeWindow(point, W) {
        let { windows, windowSize } = calcWOpts(W, this.bits), points = [], p = point, base = p;
        for (let window = 0; window < windows; window++) {
          base = p, points.push(base);
          for (let i = 1; i < windowSize; i++)
            base = base.add(p), points.push(base);
          p = base.double();
        }
        return points;
      }
      /**
       * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
       * More compact implementation:
       * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
       * @returns real and fake (for const-time) points
       */
      wNAF(W, precomputes, n) {
        if (!this.Fn.isValid(n))
          throw new Error("invalid scalar");
        let p = this.ZERO, f = this.BASE, wo = calcWOpts(W, this.bits);
        for (let window = 0; window < wo.windows; window++) {
          let { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
          n = nextN, isZero ? f = f.add(negateCt(isNegF, precomputes[offsetF])) : p = p.add(negateCt(isNeg, precomputes[offset]));
        }
        return assert0(n), { p, f };
      }
      /**
       * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
       * @param acc accumulator point to add result of multiplication
       * @returns point
       */
      wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
        let wo = calcWOpts(W, this.bits);
        for (let window = 0; window < wo.windows && n !== _0n; window++) {
          let { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
          if (n = nextN, !isZero) {
            let item = precomputes[offset];
            acc = acc.add(isNeg ? item.negate() : item);
          }
        }
        return assert0(n), acc;
      }
      getPrecomputes(W, point, transform) {
        let comp = pointPrecomputes.get(point);
        return comp || (comp = this.precomputeWindow(point, W), W !== 1 && (typeof transform == "function" && (comp = transform(comp)), pointPrecomputes.set(point, comp))), comp;
      }
      cached(point, scalar, transform) {
        let W = getW(point);
        return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
      }
      unsafe(point, scalar, transform, prev) {
        let W = getW(point);
        return W === 1 ? this._unsafeLadder(point, scalar, prev) : this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
      }
      // We calculate precomputes for elliptic curve point multiplication
      // using windowed method. This specifies window size and
      // stores precomputed values. Usually only base point would be precomputed.
      createCache(P, W) {
        validateW(W, this.bits), pointWindowSizes.set(P, W), pointPrecomputes.delete(P);
      }
      hasCache(elm) {
        return getW(elm) !== 1;
      }
    };
    exports2.wNAF = wNAF;
    function mulEndoUnsafe(Point, point, k1, k2) {
      let acc = point, p1 = Point.ZERO, p2 = Point.ZERO;
      for (; k1 > _0n || k2 > _0n; )
        k1 & _1n && (p1 = p1.add(acc)), k2 & _1n && (p2 = p2.add(acc)), acc = acc.double(), k1 >>= _1n, k2 >>= _1n;
      return { p1, p2 };
    }
    function pippenger(c, fieldN, points, scalars) {
      validateMSMPoints(points, c), validateMSMScalars(scalars, fieldN);
      let plength = points.length, slength = scalars.length;
      if (plength !== slength)
        throw new Error("arrays of points and scalars must have equal length");
      let zero = c.ZERO, wbits = (0, utils_ts_1.bitLen)(BigInt(plength)), windowSize = 1;
      wbits > 12 ? windowSize = wbits - 3 : wbits > 4 ? windowSize = wbits - 2 : wbits > 0 && (windowSize = 2);
      let MASK = (0, utils_ts_1.bitMask)(windowSize), buckets = new Array(Number(MASK) + 1).fill(zero), lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize, sum = zero;
      for (let i = lastBits; i >= 0; i -= windowSize) {
        buckets.fill(zero);
        for (let j = 0; j < slength; j++) {
          let scalar = scalars[j], wbits2 = Number(scalar >> BigInt(i) & MASK);
          buckets[wbits2] = buckets[wbits2].add(points[j]);
        }
        let resI = zero;
        for (let j = buckets.length - 1, sumI = zero; j > 0; j--)
          sumI = sumI.add(buckets[j]), resI = resI.add(sumI);
        if (sum = sum.add(resI), i !== 0)
          for (let j = 0; j < windowSize; j++)
            sum = sum.double();
      }
      return sum;
    }
    function precomputeMSMUnsafe(c, fieldN, points, windowSize) {
      validateW(windowSize, fieldN.BITS), validateMSMPoints(points, c);
      let zero = c.ZERO, tableSize = 2 ** windowSize - 1, chunks = Math.ceil(fieldN.BITS / windowSize), MASK = (0, utils_ts_1.bitMask)(windowSize), tables = points.map((p) => {
        let res = [];
        for (let i = 0, acc = p; i < tableSize; i++)
          res.push(acc), acc = acc.add(p);
        return res;
      });
      return (scalars) => {
        if (validateMSMScalars(scalars, fieldN), scalars.length > points.length)
          throw new Error("array of scalars must be smaller than array of points");
        let res = zero;
        for (let i = 0; i < chunks; i++) {
          if (res !== zero)
            for (let j = 0; j < windowSize; j++)
              res = res.double();
          let shiftBy = BigInt(chunks * windowSize - (i + 1) * windowSize);
          for (let j = 0; j < scalars.length; j++) {
            let n = scalars[j], curr = Number(n >> shiftBy & MASK);
            curr && (res = res.add(tables[j][curr - 1]));
          }
        }
        return res;
      };
    }
    function validateBasic(curve) {
      return (0, modular_ts_1.validateField)(curve.Fp), (0, utils_ts_1.validateObject)(curve, {
        n: "bigint",
        h: "bigint",
        Gx: "field",
        Gy: "field"
      }, {
        nBitLength: "isSafeInteger",
        nByteLength: "isSafeInteger"
      }), Object.freeze({
        ...(0, modular_ts_1.nLength)(curve.n, curve.nBitLength),
        ...curve,
        p: curve.Fp.ORDER
      });
    }
    function createField(order, field, isLE) {
      if (field) {
        if (field.ORDER !== order)
          throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
        return (0, modular_ts_1.validateField)(field), field;
      } else
        return (0, modular_ts_1.Field)(order, { isLE });
    }
    function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
      if (FpFnLE === void 0 && (FpFnLE = type === "edwards"), !CURVE || typeof CURVE != "object")
        throw new Error(`expected valid ${type} CURVE object`);
      for (let p of ["p", "n", "h"]) {
        let val = CURVE[p];
        if (!(typeof val == "bigint" && val > _0n))
          throw new Error(`CURVE.${p} must be positive bigint`);
      }
      let Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE), Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE), params = ["Gx", "Gy", "a", type === "weierstrass" ? "b" : "d"];
      for (let p of params)
        if (!Fp.isValid(CURVE[p]))
          throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
      return CURVE = Object.freeze(Object.assign({}, CURVE)), { CURVE, Fp, Fn };
    }
  }
});

// node_modules/@noble/curves/abstract/weierstrass.js
var require_weierstrass = __commonJS({
  "node_modules/@noble/curves/abstract/weierstrass.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.DER = exports2.DERErr = void 0;
    exports2._splitEndoScalar = _splitEndoScalar;
    exports2._normFnElement = _normFnElement;
    exports2.weierstrassN = weierstrassN;
    exports2.SWUFpSqrtRatio = SWUFpSqrtRatio;
    exports2.mapToCurveSimpleSWU = mapToCurveSimpleSWU;
    exports2.ecdh = ecdh;
    exports2.ecdsa = ecdsa;
    exports2.weierstrassPoints = weierstrassPoints;
    exports2._legacyHelperEquat = _legacyHelperEquat;
    exports2.weierstrass = weierstrass;
    /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    var hmac_js_1 = require_hmac(), utils_1 = require_utils(), utils_ts_1 = require_utils2(), curve_ts_1 = require_curve(), modular_ts_1 = require_modular(), divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n) / den;
    function _splitEndoScalar(k, basis, n) {
      let [[a1, b1], [a2, b2]] = basis, c1 = divNearest(b2 * k, n), c2 = divNearest(-b1 * k, n), k1 = k - c1 * a1 - c2 * a2, k2 = -c1 * b1 - c2 * b2, k1neg = k1 < _0n, k2neg = k2 < _0n;
      k1neg && (k1 = -k1), k2neg && (k2 = -k2);
      let MAX_NUM = (0, utils_ts_1.bitMask)(Math.ceil((0, utils_ts_1.bitLen)(n) / 2)) + _1n;
      if (k1 < _0n || k1 >= MAX_NUM || k2 < _0n || k2 >= MAX_NUM)
        throw new Error("splitScalar (endomorphism): failed, k=" + k);
      return { k1neg, k1, k2neg, k2 };
    }
    function validateSigFormat(format) {
      if (!["compact", "recovered", "der"].includes(format))
        throw new Error('Signature format must be "compact", "recovered", or "der"');
      return format;
    }
    function validateSigOpts(opts, def) {
      let optsn = {};
      for (let optName of Object.keys(def))
        optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
      return (0, utils_ts_1._abool2)(optsn.lowS, "lowS"), (0, utils_ts_1._abool2)(optsn.prehash, "prehash"), optsn.format !== void 0 && validateSigFormat(optsn.format), optsn;
    }
    var DERErr = class extends Error {
      constructor(m = "") {
        super(m);
      }
    };
    exports2.DERErr = DERErr;
    exports2.DER = {
      // asn.1 DER encoding utils
      Err: DERErr,
      // Basic building block is TLV (Tag-Length-Value)
      _tlv: {
        encode: (tag, data) => {
          let { Err: E } = exports2.DER;
          if (tag < 0 || tag > 256)
            throw new E("tlv.encode: wrong tag");
          if (data.length & 1)
            throw new E("tlv.encode: unpadded data");
          let dataLen = data.length / 2, len = (0, utils_ts_1.numberToHexUnpadded)(dataLen);
          if (len.length / 2 & 128)
            throw new E("tlv.encode: long form length too big");
          let lenLen = dataLen > 127 ? (0, utils_ts_1.numberToHexUnpadded)(len.length / 2 | 128) : "";
          return (0, utils_ts_1.numberToHexUnpadded)(tag) + lenLen + len + data;
        },
        // v - value, l - left bytes (unparsed)
        decode(tag, data) {
          let { Err: E } = exports2.DER, pos = 0;
          if (tag < 0 || tag > 256)
            throw new E("tlv.encode: wrong tag");
          if (data.length < 2 || data[pos++] !== tag)
            throw new E("tlv.decode: wrong tlv");
          let first = data[pos++], isLong = !!(first & 128), length = 0;
          if (!isLong)
            length = first;
          else {
            let lenLen = first & 127;
            if (!lenLen)
              throw new E("tlv.decode(long): indefinite length not supported");
            if (lenLen > 4)
              throw new E("tlv.decode(long): byte length is too big");
            let lengthBytes = data.subarray(pos, pos + lenLen);
            if (lengthBytes.length !== lenLen)
              throw new E("tlv.decode: length bytes not complete");
            if (lengthBytes[0] === 0)
              throw new E("tlv.decode(long): zero leftmost byte");
            for (let b of lengthBytes)
              length = length << 8 | b;
            if (pos += lenLen, length < 128)
              throw new E("tlv.decode(long): not minimal encoding");
          }
          let v = data.subarray(pos, pos + length);
          if (v.length !== length)
            throw new E("tlv.decode: wrong value length");
          return { v, l: data.subarray(pos + length) };
        }
      },
      // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
      // since we always use positive integers here. It must always be empty:
      // - add zero byte if exists
      // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
      _int: {
        encode(num) {
          let { Err: E } = exports2.DER;
          if (num < _0n)
            throw new E("integer: negative integers are not allowed");
          let hex2 = (0, utils_ts_1.numberToHexUnpadded)(num);
          if (Number.parseInt(hex2[0], 16) & 8 && (hex2 = "00" + hex2), hex2.length & 1)
            throw new E("unexpected DER parsing assertion: unpadded hex");
          return hex2;
        },
        decode(data) {
          let { Err: E } = exports2.DER;
          if (data[0] & 128)
            throw new E("invalid signature integer: negative");
          if (data[0] === 0 && !(data[1] & 128))
            throw new E("invalid signature integer: unnecessary leading zero");
          return (0, utils_ts_1.bytesToNumberBE)(data);
        }
      },
      toSig(hex2) {
        let { Err: E, _int: int, _tlv: tlv } = exports2.DER, data = (0, utils_ts_1.ensureBytes)("signature", hex2), { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
        if (seqLeftBytes.length)
          throw new E("invalid signature: left bytes after parsing");
        let { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes), { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
        if (sLeftBytes.length)
          throw new E("invalid signature: left bytes after parsing");
        return { r: int.decode(rBytes), s: int.decode(sBytes) };
      },
      hexFromSig(sig) {
        let { _tlv: tlv, _int: int } = exports2.DER, rs = tlv.encode(2, int.encode(sig.r)), ss = tlv.encode(2, int.encode(sig.s)), seq = rs + ss;
        return tlv.encode(48, seq);
      }
    };
    var _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3), _4n = BigInt(4);
    function _normFnElement(Fn, key) {
      let { BYTES: expected } = Fn, num;
      if (typeof key == "bigint")
        num = key;
      else {
        let bytes = (0, utils_ts_1.ensureBytes)("private key", key);
        try {
          num = Fn.fromBytes(bytes);
        } catch {
          throw new Error(`invalid private key: expected ui8a of size ${expected}, got ${typeof key}`);
        }
      }
      if (!Fn.isValidNot0(num))
        throw new Error("invalid private key: out of range [1..N-1]");
      return num;
    }
    function weierstrassN(params, extraOpts = {}) {
      let validated = (0, curve_ts_1._createCurveFields)("weierstrass", params, extraOpts), { Fp, Fn } = validated, CURVE = validated.CURVE, { h: cofactor, n: CURVE_ORDER } = CURVE;
      (0, utils_ts_1._validateObject)(extraOpts, {}, {
        allowInfinityPoint: "boolean",
        clearCofactor: "function",
        isTorsionFree: "function",
        fromBytes: "function",
        toBytes: "function",
        endo: "object",
        wrapPrivateKey: "boolean"
      });
      let { endo } = extraOpts;
      if (endo && (!Fp.is0(CURVE.a) || typeof endo.beta != "bigint" || !Array.isArray(endo.basises)))
        throw new Error('invalid endo: expected "beta": bigint and "basises": array');
      let lengths = getWLengths(Fp, Fn);
      function assertCompressionIsSupported() {
        if (!Fp.isOdd)
          throw new Error("compression is not supported: Field does not have .isOdd()");
      }
      function pointToBytes(_c, point, isCompressed) {
        let { x, y } = point.toAffine(), bx = Fp.toBytes(x);
        if ((0, utils_ts_1._abool2)(isCompressed, "isCompressed"), isCompressed) {
          assertCompressionIsSupported();
          let hasEvenY = !Fp.isOdd(y);
          return (0, utils_ts_1.concatBytes)(pprefix(hasEvenY), bx);
        } else
          return (0, utils_ts_1.concatBytes)(Uint8Array.of(4), bx, Fp.toBytes(y));
      }
      function pointFromBytes(bytes) {
        (0, utils_ts_1._abytes2)(bytes, void 0, "Point");
        let { publicKey: comp, publicKeyUncompressed: uncomp } = lengths, length = bytes.length, head = bytes[0], tail = bytes.subarray(1);
        if (length === comp && (head === 2 || head === 3)) {
          let x = Fp.fromBytes(tail);
          if (!Fp.isValid(x))
            throw new Error("bad point: is not on curve, wrong x");
          let y2 = weierstrassEquation(x), y;
          try {
            y = Fp.sqrt(y2);
          } catch (sqrtError) {
            let err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
            throw new Error("bad point: is not on curve, sqrt error" + err);
          }
          assertCompressionIsSupported();
          let isYOdd = Fp.isOdd(y);
          return (head & 1) === 1 !== isYOdd && (y = Fp.neg(y)), { x, y };
        } else if (length === uncomp && head === 4) {
          let L = Fp.BYTES, x = Fp.fromBytes(tail.subarray(0, L)), y = Fp.fromBytes(tail.subarray(L, L * 2));
          if (!isValidXY(x, y))
            throw new Error("bad point: is not on curve");
          return { x, y };
        } else
          throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
      }
      let encodePoint = extraOpts.toBytes || pointToBytes, decodePoint = extraOpts.fromBytes || pointFromBytes;
      function weierstrassEquation(x) {
        let x2 = Fp.sqr(x), x3 = Fp.mul(x2, x);
        return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
      }
      function isValidXY(x, y) {
        let left = Fp.sqr(y), right = weierstrassEquation(x);
        return Fp.eql(left, right);
      }
      if (!isValidXY(CURVE.Gx, CURVE.Gy))
        throw new Error("bad curve params: generator point");
      let _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n), _4n), _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
      if (Fp.is0(Fp.add(_4a3, _27b2)))
        throw new Error("bad curve params: a or b");
      function acoord(title, n, banZero = !1) {
        if (!Fp.isValid(n) || banZero && Fp.is0(n))
          throw new Error(`bad point coordinate ${title}`);
        return n;
      }
      function aprjpoint(other) {
        if (!(other instanceof Point))
          throw new Error("ProjectivePoint expected");
      }
      function splitEndoScalarN(k) {
        if (!endo || !endo.basises)
          throw new Error("no endo");
        return _splitEndoScalar(k, endo.basises, Fn.ORDER);
      }
      let toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
        let { X, Y, Z } = p;
        if (Fp.eql(Z, Fp.ONE))
          return { x: X, y: Y };
        let is0 = p.is0();
        iz == null && (iz = is0 ? Fp.ONE : Fp.inv(Z));
        let x = Fp.mul(X, iz), y = Fp.mul(Y, iz), zz = Fp.mul(Z, iz);
        if (is0)
          return { x: Fp.ZERO, y: Fp.ZERO };
        if (!Fp.eql(zz, Fp.ONE))
          throw new Error("invZ was invalid");
        return { x, y };
      }), assertValidMemo = (0, utils_ts_1.memoized)((p) => {
        if (p.is0()) {
          if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
            return;
          throw new Error("bad point: ZERO");
        }
        let { x, y } = p.toAffine();
        if (!Fp.isValid(x) || !Fp.isValid(y))
          throw new Error("bad point: x or y not field elements");
        if (!isValidXY(x, y))
          throw new Error("bad point: equation left != right");
        if (!p.isTorsionFree())
          throw new Error("bad point: not in prime-order subgroup");
        return !0;
      });
      function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
        return k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z), k1p = (0, curve_ts_1.negateCt)(k1neg, k1p), k2p = (0, curve_ts_1.negateCt)(k2neg, k2p), k1p.add(k2p);
      }
      class Point {
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        constructor(X, Y, Z) {
          this.X = acoord("x", X), this.Y = acoord("y", Y, !0), this.Z = acoord("z", Z), Object.freeze(this);
        }
        static CURVE() {
          return CURVE;
        }
        /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
        static fromAffine(p) {
          let { x, y } = p || {};
          if (!p || !Fp.isValid(x) || !Fp.isValid(y))
            throw new Error("invalid affine point");
          if (p instanceof Point)
            throw new Error("projective point not allowed");
          return Fp.is0(x) && Fp.is0(y) ? Point.ZERO : new Point(x, y, Fp.ONE);
        }
        static fromBytes(bytes) {
          let P = Point.fromAffine(decodePoint((0, utils_ts_1._abytes2)(bytes, void 0, "point")));
          return P.assertValidity(), P;
        }
        static fromHex(hex2) {
          return Point.fromBytes((0, utils_ts_1.ensureBytes)("pointHex", hex2));
        }
        get x() {
          return this.toAffine().x;
        }
        get y() {
          return this.toAffine().y;
        }
        /**
         *
         * @param windowSize
         * @param isLazy true will defer table computation until the first multiplication
         * @returns
         */
        precompute(windowSize = 8, isLazy = !0) {
          return wnaf.createCache(this, windowSize), isLazy || this.multiply(_3n), this;
        }
        // TODO: return `this`
        /** A point on curve is valid if it conforms to equation. */
        assertValidity() {
          assertValidMemo(this);
        }
        hasEvenY() {
          let { y } = this.toAffine();
          if (!Fp.isOdd)
            throw new Error("Field doesn't support isOdd");
          return !Fp.isOdd(y);
        }
        /** Compare one point to another. */
        equals(other) {
          aprjpoint(other);
          let { X: X1, Y: Y1, Z: Z1 } = this, { X: X2, Y: Y2, Z: Z2 } = other, U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1)), U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
          return U1 && U2;
        }
        /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
        negate() {
          return new Point(this.X, Fp.neg(this.Y), this.Z);
        }
        // Renes-Costello-Batina exception-free doubling formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 3
        // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
        double() {
          let { a, b } = CURVE, b3 = Fp.mul(b, _3n), { X: X1, Y: Y1, Z: Z1 } = this, X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO, t0 = Fp.mul(X1, X1), t1 = Fp.mul(Y1, Y1), t2 = Fp.mul(Z1, Z1), t3 = Fp.mul(X1, Y1);
          return t3 = Fp.add(t3, t3), Z3 = Fp.mul(X1, Z1), Z3 = Fp.add(Z3, Z3), X3 = Fp.mul(a, Z3), Y3 = Fp.mul(b3, t2), Y3 = Fp.add(X3, Y3), X3 = Fp.sub(t1, Y3), Y3 = Fp.add(t1, Y3), Y3 = Fp.mul(X3, Y3), X3 = Fp.mul(t3, X3), Z3 = Fp.mul(b3, Z3), t2 = Fp.mul(a, t2), t3 = Fp.sub(t0, t2), t3 = Fp.mul(a, t3), t3 = Fp.add(t3, Z3), Z3 = Fp.add(t0, t0), t0 = Fp.add(Z3, t0), t0 = Fp.add(t0, t2), t0 = Fp.mul(t0, t3), Y3 = Fp.add(Y3, t0), t2 = Fp.mul(Y1, Z1), t2 = Fp.add(t2, t2), t0 = Fp.mul(t2, t3), X3 = Fp.sub(X3, t0), Z3 = Fp.mul(t2, t1), Z3 = Fp.add(Z3, Z3), Z3 = Fp.add(Z3, Z3), new Point(X3, Y3, Z3);
        }
        // Renes-Costello-Batina exception-free addition formula.
        // There is 30% faster Jacobian formula, but it is not complete.
        // https://eprint.iacr.org/2015/1060, algorithm 1
        // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
        add(other) {
          aprjpoint(other);
          let { X: X1, Y: Y1, Z: Z1 } = this, { X: X2, Y: Y2, Z: Z2 } = other, X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO, a = CURVE.a, b3 = Fp.mul(CURVE.b, _3n), t0 = Fp.mul(X1, X2), t1 = Fp.mul(Y1, Y2), t2 = Fp.mul(Z1, Z2), t3 = Fp.add(X1, Y1), t4 = Fp.add(X2, Y2);
          t3 = Fp.mul(t3, t4), t4 = Fp.add(t0, t1), t3 = Fp.sub(t3, t4), t4 = Fp.add(X1, Z1);
          let t5 = Fp.add(X2, Z2);
          return t4 = Fp.mul(t4, t5), t5 = Fp.add(t0, t2), t4 = Fp.sub(t4, t5), t5 = Fp.add(Y1, Z1), X3 = Fp.add(Y2, Z2), t5 = Fp.mul(t5, X3), X3 = Fp.add(t1, t2), t5 = Fp.sub(t5, X3), Z3 = Fp.mul(a, t4), X3 = Fp.mul(b3, t2), Z3 = Fp.add(X3, Z3), X3 = Fp.sub(t1, Z3), Z3 = Fp.add(t1, Z3), Y3 = Fp.mul(X3, Z3), t1 = Fp.add(t0, t0), t1 = Fp.add(t1, t0), t2 = Fp.mul(a, t2), t4 = Fp.mul(b3, t4), t1 = Fp.add(t1, t2), t2 = Fp.sub(t0, t2), t2 = Fp.mul(a, t2), t4 = Fp.add(t4, t2), t0 = Fp.mul(t1, t4), Y3 = Fp.add(Y3, t0), t0 = Fp.mul(t5, t4), X3 = Fp.mul(t3, X3), X3 = Fp.sub(X3, t0), t0 = Fp.mul(t3, t1), Z3 = Fp.mul(t5, Z3), Z3 = Fp.add(Z3, t0), new Point(X3, Y3, Z3);
        }
        subtract(other) {
          return this.add(other.negate());
        }
        is0() {
          return this.equals(Point.ZERO);
        }
        /**
         * Constant time multiplication.
         * Uses wNAF method. Windowed method may be 10% faster,
         * but takes 2x longer to generate and consumes 2x memory.
         * Uses precomputes when available.
         * Uses endomorphism for Koblitz curves.
         * @param scalar by which the point would be multiplied
         * @returns New point
         */
        multiply(scalar) {
          let { endo: endo2 } = extraOpts;
          if (!Fn.isValidNot0(scalar))
            throw new Error("invalid scalar: out of range");
          let point, fake, mul = (n) => wnaf.cached(this, n, (p) => (0, curve_ts_1.normalizeZ)(Point, p));
          if (endo2) {
            let { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar), { p: k1p, f: k1f } = mul(k1), { p: k2p, f: k2f } = mul(k2);
            fake = k1f.add(k2f), point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
          } else {
            let { p, f } = mul(scalar);
            point = p, fake = f;
          }
          return (0, curve_ts_1.normalizeZ)(Point, [point, fake])[0];
        }
        /**
         * Non-constant-time multiplication. Uses double-and-add algorithm.
         * It's faster, but should only be used when you don't care about
         * an exposed secret key e.g. sig verification, which works over *public* keys.
         */
        multiplyUnsafe(sc) {
          let { endo: endo2 } = extraOpts, p = this;
          if (!Fn.isValid(sc))
            throw new Error("invalid scalar: out of range");
          if (sc === _0n || p.is0())
            return Point.ZERO;
          if (sc === _1n)
            return p;
          if (wnaf.hasCache(this))
            return this.multiply(sc);
          if (endo2) {
            let { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc), { p1, p2 } = (0, curve_ts_1.mulEndoUnsafe)(Point, p, k1, k2);
            return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
          } else
            return wnaf.unsafe(p, sc);
        }
        multiplyAndAddUnsafe(Q, a, b) {
          let sum = this.multiplyUnsafe(a).add(Q.multiplyUnsafe(b));
          return sum.is0() ? void 0 : sum;
        }
        /**
         * Converts Projective point to affine (x, y) coordinates.
         * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
         */
        toAffine(invertedZ) {
          return toAffineMemo(this, invertedZ);
        }
        /**
         * Checks whether Point is free of torsion elements (is in prime subgroup).
         * Always torsion-free for cofactor=1 curves.
         */
        isTorsionFree() {
          let { isTorsionFree } = extraOpts;
          return cofactor === _1n ? !0 : isTorsionFree ? isTorsionFree(Point, this) : wnaf.unsafe(this, CURVE_ORDER).is0();
        }
        clearCofactor() {
          let { clearCofactor } = extraOpts;
          return cofactor === _1n ? this : clearCofactor ? clearCofactor(Point, this) : this.multiplyUnsafe(cofactor);
        }
        isSmallOrder() {
          return this.multiplyUnsafe(cofactor).is0();
        }
        toBytes(isCompressed = !0) {
          return (0, utils_ts_1._abool2)(isCompressed, "isCompressed"), this.assertValidity(), encodePoint(Point, this, isCompressed);
        }
        toHex(isCompressed = !0) {
          return (0, utils_ts_1.bytesToHex)(this.toBytes(isCompressed));
        }
        toString() {
          return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
        }
        // TODO: remove
        get px() {
          return this.X;
        }
        get py() {
          return this.X;
        }
        get pz() {
          return this.Z;
        }
        toRawBytes(isCompressed = !0) {
          return this.toBytes(isCompressed);
        }
        _setWindowSize(windowSize) {
          this.precompute(windowSize);
        }
        static normalizeZ(points) {
          return (0, curve_ts_1.normalizeZ)(Point, points);
        }
        static msm(points, scalars) {
          return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
        }
        static fromPrivateKey(privateKey) {
          return Point.BASE.multiply(_normFnElement(Fn, privateKey));
        }
      }
      Point.BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE), Point.ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO), Point.Fp = Fp, Point.Fn = Fn;
      let bits = Fn.BITS, wnaf = new curve_ts_1.wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
      return Point.BASE.precompute(8), Point;
    }
    function pprefix(hasEvenY) {
      return Uint8Array.of(hasEvenY ? 2 : 3);
    }
    function SWUFpSqrtRatio(Fp, Z) {
      let q = Fp.ORDER, l = _0n;
      for (let o = q - _1n; o % _2n === _0n; o /= _2n)
        l += _1n;
      let c1 = l, _2n_pow_c1_1 = _2n << c1 - _1n - _1n, _2n_pow_c1 = _2n_pow_c1_1 * _2n, c2 = (q - _1n) / _2n_pow_c1, c3 = (c2 - _1n) / _2n, c4 = _2n_pow_c1 - _1n, c5 = _2n_pow_c1_1, c6 = Fp.pow(Z, c2), c7 = Fp.pow(Z, (c2 + _1n) / _2n), sqrtRatio = (u, v) => {
        let tv1 = c6, tv2 = Fp.pow(v, c4), tv3 = Fp.sqr(tv2);
        tv3 = Fp.mul(tv3, v);
        let tv5 = Fp.mul(u, tv3);
        tv5 = Fp.pow(tv5, c3), tv5 = Fp.mul(tv5, tv2), tv2 = Fp.mul(tv5, v), tv3 = Fp.mul(tv5, u);
        let tv4 = Fp.mul(tv3, tv2);
        tv5 = Fp.pow(tv4, c5);
        let isQR = Fp.eql(tv5, Fp.ONE);
        tv2 = Fp.mul(tv3, c7), tv5 = Fp.mul(tv4, tv1), tv3 = Fp.cmov(tv2, tv3, isQR), tv4 = Fp.cmov(tv5, tv4, isQR);
        for (let i = c1; i > _1n; i--) {
          let tv52 = i - _2n;
          tv52 = _2n << tv52 - _1n;
          let tvv5 = Fp.pow(tv4, tv52), e1 = Fp.eql(tvv5, Fp.ONE);
          tv2 = Fp.mul(tv3, tv1), tv1 = Fp.mul(tv1, tv1), tvv5 = Fp.mul(tv4, tv1), tv3 = Fp.cmov(tv2, tv3, e1), tv4 = Fp.cmov(tvv5, tv4, e1);
        }
        return { isValid: isQR, value: tv3 };
      };
      if (Fp.ORDER % _4n === _3n) {
        let c12 = (Fp.ORDER - _3n) / _4n, c22 = Fp.sqrt(Fp.neg(Z));
        sqrtRatio = (u, v) => {
          let tv1 = Fp.sqr(v), tv2 = Fp.mul(u, v);
          tv1 = Fp.mul(tv1, tv2);
          let y1 = Fp.pow(tv1, c12);
          y1 = Fp.mul(y1, tv2);
          let y2 = Fp.mul(y1, c22), tv3 = Fp.mul(Fp.sqr(y1), v), isQR = Fp.eql(tv3, u), y = Fp.cmov(y2, y1, isQR);
          return { isValid: isQR, value: y };
        };
      }
      return sqrtRatio;
    }
    function mapToCurveSimpleSWU(Fp, opts) {
      (0, modular_ts_1.validateField)(Fp);
      let { A, B, Z } = opts;
      if (!Fp.isValid(A) || !Fp.isValid(B) || !Fp.isValid(Z))
        throw new Error("mapToCurveSimpleSWU: invalid opts");
      let sqrtRatio = SWUFpSqrtRatio(Fp, Z);
      if (!Fp.isOdd)
        throw new Error("Field does not have .isOdd()");
      return (u) => {
        let tv1, tv2, tv3, tv4, tv5, tv6, x, y;
        tv1 = Fp.sqr(u), tv1 = Fp.mul(tv1, Z), tv2 = Fp.sqr(tv1), tv2 = Fp.add(tv2, tv1), tv3 = Fp.add(tv2, Fp.ONE), tv3 = Fp.mul(tv3, B), tv4 = Fp.cmov(Z, Fp.neg(tv2), !Fp.eql(tv2, Fp.ZERO)), tv4 = Fp.mul(tv4, A), tv2 = Fp.sqr(tv3), tv6 = Fp.sqr(tv4), tv5 = Fp.mul(tv6, A), tv2 = Fp.add(tv2, tv5), tv2 = Fp.mul(tv2, tv3), tv6 = Fp.mul(tv6, tv4), tv5 = Fp.mul(tv6, B), tv2 = Fp.add(tv2, tv5), x = Fp.mul(tv1, tv3);
        let { isValid, value } = sqrtRatio(tv2, tv6);
        y = Fp.mul(tv1, u), y = Fp.mul(y, value), x = Fp.cmov(x, tv3, isValid), y = Fp.cmov(y, value, isValid);
        let e1 = Fp.isOdd(u) === Fp.isOdd(y);
        y = Fp.cmov(Fp.neg(y), y, e1);
        let tv4_inv = (0, modular_ts_1.FpInvertBatch)(Fp, [tv4], !0)[0];
        return x = Fp.mul(x, tv4_inv), { x, y };
      };
    }
    function getWLengths(Fp, Fn) {
      return {
        secretKey: Fn.BYTES,
        publicKey: 1 + Fp.BYTES,
        publicKeyUncompressed: 1 + 2 * Fp.BYTES,
        publicKeyHasPrefix: !0,
        signature: 2 * Fn.BYTES
      };
    }
    function ecdh(Point, ecdhOpts = {}) {
      let { Fn } = Point, randomBytes_ = ecdhOpts.randomBytes || utils_ts_1.randomBytes, lengths = Object.assign(getWLengths(Point.Fp, Fn), { seed: (0, modular_ts_1.getMinHashLength)(Fn.ORDER) });
      function isValidSecretKey(secretKey) {
        try {
          return !!_normFnElement(Fn, secretKey);
        } catch {
          return !1;
        }
      }
      function isValidPublicKey(publicKey, isCompressed) {
        let { publicKey: comp, publicKeyUncompressed } = lengths;
        try {
          let l = publicKey.length;
          return isCompressed === !0 && l !== comp || isCompressed === !1 && l !== publicKeyUncompressed ? !1 : !!Point.fromBytes(publicKey);
        } catch {
          return !1;
        }
      }
      function randomSecretKey(seed = randomBytes_(lengths.seed)) {
        return (0, modular_ts_1.mapHashToField)((0, utils_ts_1._abytes2)(seed, lengths.seed, "seed"), Fn.ORDER);
      }
      function getPublicKey(secretKey, isCompressed = !0) {
        return Point.BASE.multiply(_normFnElement(Fn, secretKey)).toBytes(isCompressed);
      }
      function keygen(seed) {
        let secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
      }
      function isProbPub(item) {
        if (typeof item == "bigint")
          return !1;
        if (item instanceof Point)
          return !0;
        let { secretKey, publicKey, publicKeyUncompressed } = lengths;
        if (Fn.allowedLengths || secretKey === publicKey)
          return;
        let l = (0, utils_ts_1.ensureBytes)("key", item).length;
        return l === publicKey || l === publicKeyUncompressed;
      }
      function getSharedSecret(secretKeyA, publicKeyB, isCompressed = !0) {
        if (isProbPub(secretKeyA) === !0)
          throw new Error("first arg must be private key");
        if (isProbPub(publicKeyB) === !1)
          throw new Error("second arg must be public key");
        let s = _normFnElement(Fn, secretKeyA);
        return Point.fromHex(publicKeyB).multiply(s).toBytes(isCompressed);
      }
      return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils: {
        isValidSecretKey,
        isValidPublicKey,
        randomSecretKey,
        // TODO: remove
        isValidPrivateKey: isValidSecretKey,
        randomPrivateKey: randomSecretKey,
        normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
        precompute(windowSize = 8, point = Point.BASE) {
          return point.precompute(windowSize, !1);
        }
      }, lengths });
    }
    function ecdsa(Point, hash, ecdsaOpts = {}) {
      (0, utils_1.ahash)(hash), (0, utils_ts_1._validateObject)(ecdsaOpts, {}, {
        hmac: "function",
        lowS: "boolean",
        randomBytes: "function",
        bits2int: "function",
        bits2int_modN: "function"
      });
      let randomBytes = ecdsaOpts.randomBytes || utils_ts_1.randomBytes, hmac = ecdsaOpts.hmac || ((key, ...msgs) => (0, hmac_js_1.hmac)(hash, key, (0, utils_ts_1.concatBytes)(...msgs))), { Fp, Fn } = Point, { ORDER: CURVE_ORDER, BITS: fnBits } = Fn, { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts), defaultSigOpts = {
        prehash: !1,
        lowS: typeof ecdsaOpts.lowS == "boolean" ? ecdsaOpts.lowS : !1,
        format: void 0,
        //'compact' as ECDSASigFormat,
        extraEntropy: !1
      }, defaultSigOpts_format = "compact";
      function isBiggerThanHalfOrder(number) {
        let HALF = CURVE_ORDER >> _1n;
        return number > HALF;
      }
      function validateRS(title, num) {
        if (!Fn.isValidNot0(num))
          throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
        return num;
      }
      function validateSigLength(bytes, format) {
        validateSigFormat(format);
        let size = lengths.signature, sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
        return (0, utils_ts_1._abytes2)(bytes, sizer, `${format} signature`);
      }
      class Signature {
        constructor(r, s, recovery) {
          this.r = validateRS("r", r), this.s = validateRS("s", s), recovery != null && (this.recovery = recovery), Object.freeze(this);
        }
        static fromBytes(bytes, format = defaultSigOpts_format) {
          validateSigLength(bytes, format);
          let recid;
          if (format === "der") {
            let { r: r2, s: s2 } = exports2.DER.toSig((0, utils_ts_1._abytes2)(bytes));
            return new Signature(r2, s2);
          }
          format === "recovered" && (recid = bytes[0], format = "compact", bytes = bytes.subarray(1));
          let L = Fn.BYTES, r = bytes.subarray(0, L), s = bytes.subarray(L, L * 2);
          return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
        }
        static fromHex(hex2, format) {
          return this.fromBytes((0, utils_ts_1.hexToBytes)(hex2), format);
        }
        addRecoveryBit(recovery) {
          return new Signature(this.r, this.s, recovery);
        }
        recoverPublicKey(messageHash) {
          let FIELD_ORDER = Fp.ORDER, { r, s, recovery: rec } = this;
          if (rec == null || ![0, 1, 2, 3].includes(rec))
            throw new Error("recovery id invalid");
          if (CURVE_ORDER * _2n < FIELD_ORDER && rec > 1)
            throw new Error("recovery id is ambiguous for h>1 curve");
          let radj = rec === 2 || rec === 3 ? r + CURVE_ORDER : r;
          if (!Fp.isValid(radj))
            throw new Error("recovery id 2 or 3 invalid");
          let x = Fp.toBytes(radj), R = Point.fromBytes((0, utils_ts_1.concatBytes)(pprefix((rec & 1) === 0), x)), ir = Fn.inv(radj), h = bits2int_modN((0, utils_ts_1.ensureBytes)("msgHash", messageHash)), u1 = Fn.create(-h * ir), u2 = Fn.create(s * ir), Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
          if (Q.is0())
            throw new Error("point at infinify");
          return Q.assertValidity(), Q;
        }
        // Signatures should be low-s, to prevent malleability.
        hasHighS() {
          return isBiggerThanHalfOrder(this.s);
        }
        toBytes(format = defaultSigOpts_format) {
          if (validateSigFormat(format), format === "der")
            return (0, utils_ts_1.hexToBytes)(exports2.DER.hexFromSig(this));
          let r = Fn.toBytes(this.r), s = Fn.toBytes(this.s);
          if (format === "recovered") {
            if (this.recovery == null)
              throw new Error("recovery bit must be present");
            return (0, utils_ts_1.concatBytes)(Uint8Array.of(this.recovery), r, s);
          }
          return (0, utils_ts_1.concatBytes)(r, s);
        }
        toHex(format) {
          return (0, utils_ts_1.bytesToHex)(this.toBytes(format));
        }
        // TODO: remove
        assertValidity() {
        }
        static fromCompact(hex2) {
          return Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", hex2), "compact");
        }
        static fromDER(hex2) {
          return Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", hex2), "der");
        }
        normalizeS() {
          return this.hasHighS() ? new Signature(this.r, Fn.neg(this.s), this.recovery) : this;
        }
        toDERRawBytes() {
          return this.toBytes("der");
        }
        toDERHex() {
          return (0, utils_ts_1.bytesToHex)(this.toBytes("der"));
        }
        toCompactRawBytes() {
          return this.toBytes("compact");
        }
        toCompactHex() {
          return (0, utils_ts_1.bytesToHex)(this.toBytes("compact"));
        }
      }
      let bits2int = ecdsaOpts.bits2int || function(bytes) {
        if (bytes.length > 8192)
          throw new Error("input is too large");
        let num = (0, utils_ts_1.bytesToNumberBE)(bytes), delta = bytes.length * 8 - fnBits;
        return delta > 0 ? num >> BigInt(delta) : num;
      }, bits2int_modN = ecdsaOpts.bits2int_modN || function(bytes) {
        return Fn.create(bits2int(bytes));
      }, ORDER_MASK = (0, utils_ts_1.bitMask)(fnBits);
      function int2octets(num) {
        return (0, utils_ts_1.aInRange)("num < 2^" + fnBits, num, _0n, ORDER_MASK), Fn.toBytes(num);
      }
      function validateMsgAndHash(message, prehash) {
        return (0, utils_ts_1._abytes2)(message, void 0, "message"), prehash ? (0, utils_ts_1._abytes2)(hash(message), void 0, "prehashed message") : message;
      }
      function prepSig(message, privateKey, opts) {
        if (["recovered", "canonical"].some((k) => k in opts))
          throw new Error("sign() legacy options not supported");
        let { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
        message = validateMsgAndHash(message, prehash);
        let h1int = bits2int_modN(message), d = _normFnElement(Fn, privateKey), seedArgs = [int2octets(d), int2octets(h1int)];
        if (extraEntropy != null && extraEntropy !== !1) {
          let e = extraEntropy === !0 ? randomBytes(lengths.secretKey) : extraEntropy;
          seedArgs.push((0, utils_ts_1.ensureBytes)("extraEntropy", e));
        }
        let seed = (0, utils_ts_1.concatBytes)(...seedArgs), m = h1int;
        function k2sig(kBytes) {
          let k = bits2int(kBytes);
          if (!Fn.isValidNot0(k))
            return;
          let ik = Fn.inv(k), q = Point.BASE.multiply(k).toAffine(), r = Fn.create(q.x);
          if (r === _0n)
            return;
          let s = Fn.create(ik * Fn.create(m + r * d));
          if (s === _0n)
            return;
          let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n), normS = s;
          return lowS && isBiggerThanHalfOrder(s) && (normS = Fn.neg(s), recovery ^= 1), new Signature(r, normS, recovery);
        }
        return { seed, k2sig };
      }
      function sign(message, secretKey, opts = {}) {
        message = (0, utils_ts_1.ensureBytes)("message", message);
        let { seed, k2sig } = prepSig(message, secretKey, opts);
        return (0, utils_ts_1.createHmacDrbg)(hash.outputLen, Fn.BYTES, hmac)(seed, k2sig);
      }
      function tryParsingSig(sg) {
        let sig, isHex = typeof sg == "string" || (0, utils_ts_1.isBytes)(sg), isObj = !isHex && sg !== null && typeof sg == "object" && typeof sg.r == "bigint" && typeof sg.s == "bigint";
        if (!isHex && !isObj)
          throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");
        if (isObj)
          sig = new Signature(sg.r, sg.s);
        else if (isHex) {
          try {
            sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", sg), "der");
          } catch (derError) {
            if (!(derError instanceof exports2.DER.Err))
              throw derError;
          }
          if (!sig)
            try {
              sig = Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", sg), "compact");
            } catch {
              return !1;
            }
        }
        return sig || !1;
      }
      function verify(signature, message, publicKey, opts = {}) {
        let { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
        if (publicKey = (0, utils_ts_1.ensureBytes)("publicKey", publicKey), message = validateMsgAndHash((0, utils_ts_1.ensureBytes)("message", message), prehash), "strict" in opts)
          throw new Error("options.strict was renamed to lowS");
        let sig = format === void 0 ? tryParsingSig(signature) : Signature.fromBytes((0, utils_ts_1.ensureBytes)("sig", signature), format);
        if (sig === !1)
          return !1;
        try {
          let P = Point.fromBytes(publicKey);
          if (lowS && sig.hasHighS())
            return !1;
          let { r, s } = sig, h = bits2int_modN(message), is = Fn.inv(s), u1 = Fn.create(h * is), u2 = Fn.create(r * is), R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
          return R.is0() ? !1 : Fn.create(R.x) === r;
        } catch {
          return !1;
        }
      }
      function recoverPublicKey(signature, message, opts = {}) {
        let { prehash } = validateSigOpts(opts, defaultSigOpts);
        return message = validateMsgAndHash(message, prehash), Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
      }
      return Object.freeze({
        keygen,
        getPublicKey,
        getSharedSecret,
        utils,
        lengths,
        Point,
        sign,
        verify,
        recoverPublicKey,
        Signature,
        hash
      });
    }
    function weierstrassPoints(c) {
      let { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c), Point = weierstrassN(CURVE, curveOpts);
      return _weierstrass_new_output_to_legacy(c, Point);
    }
    function _weierstrass_legacy_opts_to_new(c) {
      let CURVE = {
        a: c.a,
        b: c.b,
        p: c.Fp.ORDER,
        n: c.n,
        h: c.h,
        Gx: c.Gx,
        Gy: c.Gy
      }, Fp = c.Fp, allowedLengths = c.allowedPrivateKeyLengths ? Array.from(new Set(c.allowedPrivateKeyLengths.map((l) => Math.ceil(l / 2)))) : void 0, Fn = (0, modular_ts_1.Field)(CURVE.n, {
        BITS: c.nBitLength,
        allowedLengths,
        modFromBytes: c.wrapPrivateKey
      }), curveOpts = {
        Fp,
        Fn,
        allowInfinityPoint: c.allowInfinityPoint,
        endo: c.endo,
        isTorsionFree: c.isTorsionFree,
        clearCofactor: c.clearCofactor,
        fromBytes: c.fromBytes,
        toBytes: c.toBytes
      };
      return { CURVE, curveOpts };
    }
    function _ecdsa_legacy_opts_to_new(c) {
      let { CURVE, curveOpts } = _weierstrass_legacy_opts_to_new(c), ecdsaOpts = {
        hmac: c.hmac,
        randomBytes: c.randomBytes,
        lowS: c.lowS,
        bits2int: c.bits2int,
        bits2int_modN: c.bits2int_modN
      };
      return { CURVE, curveOpts, hash: c.hash, ecdsaOpts };
    }
    function _legacyHelperEquat(Fp, a, b) {
      function weierstrassEquation(x) {
        let x2 = Fp.sqr(x), x3 = Fp.mul(x2, x);
        return Fp.add(Fp.add(x3, Fp.mul(x, a)), b);
      }
      return weierstrassEquation;
    }
    function _weierstrass_new_output_to_legacy(c, Point) {
      let { Fp, Fn } = Point;
      function isWithinCurveOrder(num) {
        return (0, utils_ts_1.inRange)(num, _1n, Fn.ORDER);
      }
      let weierstrassEquation = _legacyHelperEquat(Fp, c.a, c.b);
      return Object.assign({}, {
        CURVE: c,
        Point,
        ProjectivePoint: Point,
        normPrivateKeyToScalar: (key) => _normFnElement(Fn, key),
        weierstrassEquation,
        isWithinCurveOrder
      });
    }
    function _ecdsa_new_output_to_legacy(c, _ecdsa) {
      let Point = _ecdsa.Point;
      return Object.assign({}, _ecdsa, {
        ProjectivePoint: Point,
        CURVE: Object.assign({}, c, (0, modular_ts_1.nLength)(Point.Fn.ORDER, Point.Fn.BITS))
      });
    }
    function weierstrass(c) {
      let { CURVE, curveOpts, hash, ecdsaOpts } = _ecdsa_legacy_opts_to_new(c), Point = weierstrassN(CURVE, curveOpts), signs = ecdsa(Point, hash, ecdsaOpts);
      return _ecdsa_new_output_to_legacy(c, signs);
    }
  }
});

// node_modules/@noble/curves/_shortw_utils.js
var require_shortw_utils = __commonJS({
  "node_modules/@noble/curves/_shortw_utils.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.getHash = getHash;
    exports2.createCurve = createCurve;
    /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    var weierstrass_ts_1 = require_weierstrass();
    function getHash(hash) {
      return { hash };
    }
    function createCurve(curveDef, defHash) {
      let create = (hash) => (0, weierstrass_ts_1.weierstrass)({ ...curveDef, hash });
      return { ...create(defHash), create };
    }
  }
});

// node_modules/@noble/curves/abstract/hash-to-curve.js
var require_hash_to_curve = __commonJS({
  "node_modules/@noble/curves/abstract/hash-to-curve.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2._DST_scalar = void 0;
    exports2.expand_message_xmd = expand_message_xmd;
    exports2.expand_message_xof = expand_message_xof;
    exports2.hash_to_field = hash_to_field;
    exports2.isogenyMap = isogenyMap;
    exports2.createHasher = createHasher;
    var utils_ts_1 = require_utils2(), modular_ts_1 = require_modular(), os2ip = utils_ts_1.bytesToNumberBE;
    function i2osp(value, length) {
      if (anum(value), anum(length), value < 0 || value >= 1 << 8 * length)
        throw new Error("invalid I2OSP input: " + value);
      let res = Array.from({ length }).fill(0);
      for (let i = length - 1; i >= 0; i--)
        res[i] = value & 255, value >>>= 8;
      return new Uint8Array(res);
    }
    function strxor(a, b) {
      let arr = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++)
        arr[i] = a[i] ^ b[i];
      return arr;
    }
    function anum(item) {
      if (!Number.isSafeInteger(item))
        throw new Error("number expected");
    }
    function normDST(DST) {
      if (!(0, utils_ts_1.isBytes)(DST) && typeof DST != "string")
        throw new Error("DST must be Uint8Array or string");
      return typeof DST == "string" ? (0, utils_ts_1.utf8ToBytes)(DST) : DST;
    }
    function expand_message_xmd(msg, DST, lenInBytes, H) {
      (0, utils_ts_1.abytes)(msg), anum(lenInBytes), DST = normDST(DST), DST.length > 255 && (DST = H((0, utils_ts_1.concatBytes)((0, utils_ts_1.utf8ToBytes)("H2C-OVERSIZE-DST-"), DST)));
      let { outputLen: b_in_bytes, blockLen: r_in_bytes } = H, ell = Math.ceil(lenInBytes / b_in_bytes);
      if (lenInBytes > 65535 || ell > 255)
        throw new Error("expand_message_xmd: invalid lenInBytes");
      let DST_prime = (0, utils_ts_1.concatBytes)(DST, i2osp(DST.length, 1)), Z_pad = i2osp(0, r_in_bytes), l_i_b_str = i2osp(lenInBytes, 2), b = new Array(ell), b_0 = H((0, utils_ts_1.concatBytes)(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
      b[0] = H((0, utils_ts_1.concatBytes)(b_0, i2osp(1, 1), DST_prime));
      for (let i = 1; i <= ell; i++) {
        let args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
        b[i] = H((0, utils_ts_1.concatBytes)(...args));
      }
      return (0, utils_ts_1.concatBytes)(...b).slice(0, lenInBytes);
    }
    function expand_message_xof(msg, DST, lenInBytes, k, H) {
      if ((0, utils_ts_1.abytes)(msg), anum(lenInBytes), DST = normDST(DST), DST.length > 255) {
        let dkLen = Math.ceil(2 * k / 8);
        DST = H.create({ dkLen }).update((0, utils_ts_1.utf8ToBytes)("H2C-OVERSIZE-DST-")).update(DST).digest();
      }
      if (lenInBytes > 65535 || DST.length > 255)
        throw new Error("expand_message_xof: invalid lenInBytes");
      return H.create({ dkLen: lenInBytes }).update(msg).update(i2osp(lenInBytes, 2)).update(DST).update(i2osp(DST.length, 1)).digest();
    }
    function hash_to_field(msg, count, options) {
      (0, utils_ts_1._validateObject)(options, {
        p: "bigint",
        m: "number",
        k: "number",
        hash: "function"
      });
      let { p, k, m, hash, expand, DST } = options;
      if (!(0, utils_ts_1.isHash)(options.hash))
        throw new Error("expected valid hash");
      (0, utils_ts_1.abytes)(msg), anum(count);
      let log2p = p.toString(2).length, L = Math.ceil((log2p + k) / 8), len_in_bytes = count * m * L, prb;
      if (expand === "xmd")
        prb = expand_message_xmd(msg, DST, len_in_bytes, hash);
      else if (expand === "xof")
        prb = expand_message_xof(msg, DST, len_in_bytes, k, hash);
      else if (expand === "_internal_pass")
        prb = msg;
      else
        throw new Error('expand must be "xmd" or "xof"');
      let u = new Array(count);
      for (let i = 0; i < count; i++) {
        let e = new Array(m);
        for (let j = 0; j < m; j++) {
          let elm_offset = L * (j + i * m), tv = prb.subarray(elm_offset, elm_offset + L);
          e[j] = (0, modular_ts_1.mod)(os2ip(tv), p);
        }
        u[i] = e;
      }
      return u;
    }
    function isogenyMap(field, map) {
      let coeff = map.map((i) => Array.from(i).reverse());
      return (x, y) => {
        let [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i))), [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(field, [xd, yd], !0);
        return x = field.mul(xn, xd_inv), y = field.mul(y, field.mul(yn, yd_inv)), { x, y };
      };
    }
    exports2._DST_scalar = (0, utils_ts_1.utf8ToBytes)("HashToScalar-");
    function createHasher(Point, mapToCurve, defaults) {
      if (typeof mapToCurve != "function")
        throw new Error("mapToCurve() must be defined");
      function map(num) {
        return Point.fromAffine(mapToCurve(num));
      }
      function clear(initial) {
        let P = initial.clearCofactor();
        return P.equals(Point.ZERO) ? Point.ZERO : (P.assertValidity(), P);
      }
      return {
        defaults,
        hashToCurve(msg, options) {
          let opts = Object.assign({}, defaults, options), u = hash_to_field(msg, 2, opts), u0 = map(u[0]), u1 = map(u[1]);
          return clear(u0.add(u1));
        },
        encodeToCurve(msg, options) {
          let optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {}, opts = Object.assign({}, defaults, optsDst, options), u = hash_to_field(msg, 1, opts), u0 = map(u[0]);
          return clear(u0);
        },
        /** See {@link H2CHasher} */
        mapToCurve(scalars) {
          if (!Array.isArray(scalars))
            throw new Error("expected array of bigints");
          for (let i of scalars)
            if (typeof i != "bigint")
              throw new Error("expected array of bigints");
          return clear(map(scalars));
        },
        // hash_to_scalar can produce 0: https://www.rfc-editor.org/errata/eid8393
        // RFC 9380, draft-irtf-cfrg-bbs-signatures-08
        hashToScalar(msg, options) {
          let N = Point.Fn.ORDER, opts = Object.assign({}, defaults, { p: N, m: 1, DST: exports2._DST_scalar }, options);
          return hash_to_field(msg, 1, opts)[0][0];
        }
      };
    }
  }
});

// node_modules/@noble/curves/secp256k1.js
var require_secp256k1 = __commonJS({
  "node_modules/@noble/curves/secp256k1.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.encodeToCurve = exports2.hashToCurve = exports2.secp256k1_hasher = exports2.schnorr = exports2.secp256k1 = void 0;
    /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    var sha2_js_1 = require_sha2(), utils_js_1 = require_utils(), _shortw_utils_ts_1 = require_shortw_utils(), hash_to_curve_ts_1 = require_hash_to_curve(), modular_ts_1 = require_modular(), weierstrass_ts_1 = require_weierstrass(), utils_ts_1 = require_utils2(), secp256k1_CURVE = {
      p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
      n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
      h: BigInt(1),
      a: BigInt(0),
      b: BigInt(7),
      Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
      Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
    }, secp256k1_ENDO = {
      beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
      basises: [
        [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
        [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
      ]
    }, _0n = /* @__PURE__ */ BigInt(0), _1n = /* @__PURE__ */ BigInt(1), _2n = /* @__PURE__ */ BigInt(2);
    function sqrtMod(y) {
      let P = secp256k1_CURVE.p, _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22), _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88), b2 = y * y * y % P, b3 = b2 * b2 * y % P, b6 = (0, modular_ts_1.pow2)(b3, _3n, P) * b3 % P, b9 = (0, modular_ts_1.pow2)(b6, _3n, P) * b3 % P, b11 = (0, modular_ts_1.pow2)(b9, _2n, P) * b2 % P, b22 = (0, modular_ts_1.pow2)(b11, _11n, P) * b11 % P, b44 = (0, modular_ts_1.pow2)(b22, _22n, P) * b22 % P, b88 = (0, modular_ts_1.pow2)(b44, _44n, P) * b44 % P, b176 = (0, modular_ts_1.pow2)(b88, _88n, P) * b88 % P, b220 = (0, modular_ts_1.pow2)(b176, _44n, P) * b44 % P, b223 = (0, modular_ts_1.pow2)(b220, _3n, P) * b3 % P, t1 = (0, modular_ts_1.pow2)(b223, _23n, P) * b22 % P, t2 = (0, modular_ts_1.pow2)(t1, _6n, P) * b2 % P, root = (0, modular_ts_1.pow2)(t2, _2n, P);
      if (!Fpk1.eql(Fpk1.sqr(root), y))
        throw new Error("Cannot find square root");
      return root;
    }
    var Fpk1 = (0, modular_ts_1.Field)(secp256k1_CURVE.p, { sqrt: sqrtMod });
    exports2.secp256k1 = (0, _shortw_utils_ts_1.createCurve)({ ...secp256k1_CURVE, Fp: Fpk1, lowS: !0, endo: secp256k1_ENDO }, sha2_js_1.sha256);
    var TAGGED_HASH_PREFIXES = {};
    function taggedHash(tag, ...messages) {
      let tagP = TAGGED_HASH_PREFIXES[tag];
      if (tagP === void 0) {
        let tagH = (0, sha2_js_1.sha256)((0, utils_ts_1.utf8ToBytes)(tag));
        tagP = (0, utils_ts_1.concatBytes)(tagH, tagH), TAGGED_HASH_PREFIXES[tag] = tagP;
      }
      return (0, sha2_js_1.sha256)((0, utils_ts_1.concatBytes)(tagP, ...messages));
    }
    var pointToBytes = (point) => point.toBytes(!0).slice(1), Pointk1 = exports2.secp256k1.Point, hasEven = (y) => y % _2n === _0n;
    function schnorrGetExtPubKey(priv) {
      let { Fn, BASE } = Pointk1, d_ = (0, weierstrass_ts_1._normFnElement)(Fn, priv), p = BASE.multiply(d_);
      return { scalar: hasEven(p.y) ? d_ : Fn.neg(d_), bytes: pointToBytes(p) };
    }
    function lift_x(x) {
      let Fp = Fpk1;
      if (!Fp.isValidNot0(x))
        throw new Error("invalid x: Fail if x \u2265 p");
      let xx = Fp.create(x * x), c = Fp.create(xx * x + BigInt(7)), y = Fp.sqrt(c);
      hasEven(y) || (y = Fp.neg(y));
      let p = Pointk1.fromAffine({ x, y });
      return p.assertValidity(), p;
    }
    var num = utils_ts_1.bytesToNumberBE;
    function challenge(...args) {
      return Pointk1.Fn.create(num(taggedHash("BIP0340/challenge", ...args)));
    }
    function schnorrGetPublicKey(secretKey) {
      return schnorrGetExtPubKey(secretKey).bytes;
    }
    function schnorrSign(message, secretKey, auxRand = (0, utils_js_1.randomBytes)(32)) {
      let { Fn } = Pointk1, m = (0, utils_ts_1.ensureBytes)("message", message), { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey), a = (0, utils_ts_1.ensureBytes)("auxRand", auxRand, 32), t = Fn.toBytes(d ^ num(taggedHash("BIP0340/aux", a))), rand = taggedHash("BIP0340/nonce", t, px, m), { bytes: rx, scalar: k } = schnorrGetExtPubKey(rand), e = challenge(rx, px, m), sig = new Uint8Array(64);
      if (sig.set(rx, 0), sig.set(Fn.toBytes(Fn.create(k + e * d)), 32), !schnorrVerify(sig, m, px))
        throw new Error("sign: Invalid signature produced");
      return sig;
    }
    function schnorrVerify(signature, message, publicKey) {
      let { Fn, BASE } = Pointk1, sig = (0, utils_ts_1.ensureBytes)("signature", signature, 64), m = (0, utils_ts_1.ensureBytes)("message", message), pub = (0, utils_ts_1.ensureBytes)("publicKey", publicKey, 32);
      try {
        let P = lift_x(num(pub)), r = num(sig.subarray(0, 32));
        if (!(0, utils_ts_1.inRange)(r, _1n, secp256k1_CURVE.p))
          return !1;
        let s = num(sig.subarray(32, 64));
        if (!(0, utils_ts_1.inRange)(s, _1n, secp256k1_CURVE.n))
          return !1;
        let e = challenge(Fn.toBytes(r), pointToBytes(P), m), R = BASE.multiplyUnsafe(s).add(P.multiplyUnsafe(Fn.neg(e))), { x, y } = R.toAffine();
        return !(R.is0() || !hasEven(y) || x !== r);
      } catch {
        return !1;
      }
    }
    exports2.schnorr = (() => {
      let randomSecretKey = (seed = (0, utils_js_1.randomBytes)(48)) => (0, modular_ts_1.mapHashToField)(seed, secp256k1_CURVE.n);
      exports2.secp256k1.utils.randomSecretKey;
      function keygen(seed) {
        let secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: schnorrGetPublicKey(secretKey) };
      }
      return {
        keygen,
        getPublicKey: schnorrGetPublicKey,
        sign: schnorrSign,
        verify: schnorrVerify,
        Point: Pointk1,
        utils: {
          randomSecretKey,
          randomPrivateKey: randomSecretKey,
          taggedHash,
          // TODO: remove
          lift_x,
          pointToBytes,
          numberToBytesBE: utils_ts_1.numberToBytesBE,
          bytesToNumberBE: utils_ts_1.bytesToNumberBE,
          mod: modular_ts_1.mod
        },
        lengths: {
          secretKey: 32,
          publicKey: 32,
          publicKeyHasPrefix: !1,
          signature: 64,
          seed: 48
        }
      };
    })();
    var isoMap = (0, hash_to_curve_ts_1.isogenyMap)(Fpk1, [
      // xNum
      [
        "0x8e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38daaaaa8c7",
        "0x7d3d4c80bc321d5b9f315cea7fd44c5d595d2fc0bf63b92dfff1044f17c6581",
        "0x534c328d23f234e6e2a413deca25caece4506144037c40314ecbd0b53d9dd262",
        "0x8e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38e38daaaaa88c"
      ],
      // xDen
      [
        "0xd35771193d94918a9ca34ccbb7b640dd86cd409542f8487d9fe6b745781eb49b",
        "0xedadc6f64383dc1df7c4b2d51b54225406d36b641f5e41bbc52a56612a8c6d14",
        "0x0000000000000000000000000000000000000000000000000000000000000001"
        // LAST 1
      ],
      // yNum
      [
        "0x4bda12f684bda12f684bda12f684bda12f684bda12f684bda12f684b8e38e23c",
        "0xc75e0c32d5cb7c0fa9d0a54b12a0a6d5647ab046d686da6fdffc90fc201d71a3",
        "0x29a6194691f91a73715209ef6512e576722830a201be2018a765e85a9ecee931",
        "0x2f684bda12f684bda12f684bda12f684bda12f684bda12f684bda12f38e38d84"
      ],
      // yDen
      [
        "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffff93b",
        "0x7a06534bb8bdb49fd5e9e6632722c2989467c1bfc8e8d978dfb425d2685c2573",
        "0x6484aa716545ca2cf3a70c3fa8fe337e0a3d21162f0d6299a7bf8192bfd2a76f",
        "0x0000000000000000000000000000000000000000000000000000000000000001"
        // LAST 1
      ]
    ].map((i) => i.map((j) => BigInt(j)))), mapSWU = (0, weierstrass_ts_1.mapToCurveSimpleSWU)(Fpk1, {
      A: BigInt("0x3f8731abdd661adca08a5558f0f5d272e953d363cb6f0e5d405447c01a444533"),
      B: BigInt("1771"),
      Z: Fpk1.create(BigInt("-11"))
    });
    exports2.secp256k1_hasher = (0, hash_to_curve_ts_1.createHasher)(exports2.secp256k1.Point, (scalars) => {
      let { x, y } = mapSWU(Fpk1.create(scalars[0]));
      return isoMap(x, y);
    }, {
      DST: "secp256k1_XMD:SHA-256_SSWU_RO_",
      encodeDST: "secp256k1_XMD:SHA-256_SSWU_NU_",
      p: Fpk1.ORDER,
      m: 1,
      k: 128,
      expand: "xmd",
      hash: sha2_js_1.sha256
    });
    exports2.hashToCurve = exports2.secp256k1_hasher.hashToCurve;
    exports2.encodeToCurve = exports2.secp256k1_hasher.encodeToCurve;
  }
});

// node_modules/@noble/hashes/sha3.js
var require_sha3 = __commonJS({
  "node_modules/@noble/hashes/sha3.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: !0 });
    exports2.shake256 = exports2.shake128 = exports2.keccak_512 = exports2.keccak_384 = exports2.keccak_256 = exports2.keccak_224 = exports2.sha3_512 = exports2.sha3_384 = exports2.sha3_256 = exports2.sha3_224 = exports2.Keccak = void 0;
    exports2.keccakP = keccakP;
    var _u64_ts_1 = require_u64(), utils_ts_1 = require_utils(), _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _7n = BigInt(7), _256n = BigInt(256), _0x71n = BigInt(113), SHA3_PI = [], SHA3_ROTL = [], _SHA3_IOTA = [];
    for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
      [x, y] = [y, (2 * x + 3 * y) % 5], SHA3_PI.push(2 * (5 * y + x)), SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
      let t = _0n;
      for (let j = 0; j < 7; j++)
        R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n, R & _2n && (t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n);
      _SHA3_IOTA.push(t);
    }
    var IOTAS = (0, _u64_ts_1.split)(_SHA3_IOTA, !0), SHA3_IOTA_H = IOTAS[0], SHA3_IOTA_L = IOTAS[1], rotlH = (h, l, s) => s > 32 ? (0, _u64_ts_1.rotlBH)(h, l, s) : (0, _u64_ts_1.rotlSH)(h, l, s), rotlL = (h, l, s) => s > 32 ? (0, _u64_ts_1.rotlBL)(h, l, s) : (0, _u64_ts_1.rotlSL)(h, l, s);
    function keccakP(s, rounds = 24) {
      let B = new Uint32Array(10);
      for (let round = 24 - rounds; round < 24; round++) {
        for (let x = 0; x < 10; x++)
          B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
        for (let x = 0; x < 10; x += 2) {
          let idx1 = (x + 8) % 10, idx0 = (x + 2) % 10, B0 = B[idx0], B1 = B[idx0 + 1], Th = rotlH(B0, B1, 1) ^ B[idx1], Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
          for (let y = 0; y < 50; y += 10)
            s[x + y] ^= Th, s[x + y + 1] ^= Tl;
        }
        let curH = s[2], curL = s[3];
        for (let t = 0; t < 24; t++) {
          let shift = SHA3_ROTL[t], Th = rotlH(curH, curL, shift), Tl = rotlL(curH, curL, shift), PI = SHA3_PI[t];
          curH = s[PI], curL = s[PI + 1], s[PI] = Th, s[PI + 1] = Tl;
        }
        for (let y = 0; y < 50; y += 10) {
          for (let x = 0; x < 10; x++)
            B[x] = s[y + x];
          for (let x = 0; x < 10; x++)
            s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
        }
        s[0] ^= SHA3_IOTA_H[round], s[1] ^= SHA3_IOTA_L[round];
      }
      (0, utils_ts_1.clean)(B);
    }
    var Keccak = class _Keccak extends utils_ts_1.Hash {
      // NOTE: we accept arguments in bytes instead of bits here.
      constructor(blockLen, suffix, outputLen, enableXOF = !1, rounds = 24) {
        if (super(), this.pos = 0, this.posOut = 0, this.finished = !1, this.destroyed = !1, this.enableXOF = !1, this.blockLen = blockLen, this.suffix = suffix, this.outputLen = outputLen, this.enableXOF = enableXOF, this.rounds = rounds, (0, utils_ts_1.anumber)(outputLen), !(0 < blockLen && blockLen < 200))
          throw new Error("only keccak-f1600 function is supported");
        this.state = new Uint8Array(200), this.state32 = (0, utils_ts_1.u32)(this.state);
      }
      clone() {
        return this._cloneInto();
      }
      keccak() {
        (0, utils_ts_1.swap32IfBE)(this.state32), keccakP(this.state32, this.rounds), (0, utils_ts_1.swap32IfBE)(this.state32), this.posOut = 0, this.pos = 0;
      }
      update(data) {
        (0, utils_ts_1.aexists)(this), data = (0, utils_ts_1.toBytes)(data), (0, utils_ts_1.abytes)(data);
        let { blockLen, state } = this, len = data.length;
        for (let pos = 0; pos < len; ) {
          let take = Math.min(blockLen - this.pos, len - pos);
          for (let i = 0; i < take; i++)
            state[this.pos++] ^= data[pos++];
          this.pos === blockLen && this.keccak();
        }
        return this;
      }
      finish() {
        if (this.finished)
          return;
        this.finished = !0;
        let { state, suffix, pos, blockLen } = this;
        state[pos] ^= suffix, (suffix & 128) !== 0 && pos === blockLen - 1 && this.keccak(), state[blockLen - 1] ^= 128, this.keccak();
      }
      writeInto(out) {
        (0, utils_ts_1.aexists)(this, !1), (0, utils_ts_1.abytes)(out), this.finish();
        let bufferOut = this.state, { blockLen } = this;
        for (let pos = 0, len = out.length; pos < len; ) {
          this.posOut >= blockLen && this.keccak();
          let take = Math.min(blockLen - this.posOut, len - pos);
          out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos), this.posOut += take, pos += take;
        }
        return out;
      }
      xofInto(out) {
        if (!this.enableXOF)
          throw new Error("XOF is not possible for this instance");
        return this.writeInto(out);
      }
      xof(bytes) {
        return (0, utils_ts_1.anumber)(bytes), this.xofInto(new Uint8Array(bytes));
      }
      digestInto(out) {
        if ((0, utils_ts_1.aoutput)(out, this), this.finished)
          throw new Error("digest() was already called");
        return this.writeInto(out), this.destroy(), out;
      }
      digest() {
        return this.digestInto(new Uint8Array(this.outputLen));
      }
      destroy() {
        this.destroyed = !0, (0, utils_ts_1.clean)(this.state);
      }
      _cloneInto(to) {
        let { blockLen, suffix, outputLen, rounds, enableXOF } = this;
        return to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds)), to.state32.set(this.state32), to.pos = this.pos, to.posOut = this.posOut, to.finished = this.finished, to.rounds = rounds, to.suffix = suffix, to.outputLen = outputLen, to.enableXOF = enableXOF, to.destroyed = this.destroyed, to;
      }
    };
    exports2.Keccak = Keccak;
    var gen = (suffix, blockLen, outputLen) => (0, utils_ts_1.createHasher)(() => new Keccak(blockLen, suffix, outputLen));
    exports2.sha3_224 = gen(6, 144, 224 / 8);
    exports2.sha3_256 = gen(6, 136, 256 / 8);
    exports2.sha3_384 = gen(6, 104, 384 / 8);
    exports2.sha3_512 = gen(6, 72, 512 / 8);
    exports2.keccak_224 = gen(1, 144, 224 / 8);
    exports2.keccak_256 = gen(1, 136, 256 / 8);
    exports2.keccak_384 = gen(1, 104, 384 / 8);
    exports2.keccak_512 = gen(1, 72, 512 / 8);
    var genShake = (suffix, blockLen, outputLen) => (0, utils_ts_1.createXOFer)((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, !0));
    exports2.shake128 = genShake(31, 168, 128 / 8);
    exports2.shake256 = genShake(31, 136, 256 / 8);
  }
});

// entry.js
var { secp256k1 } = require_secp256k1(), { keccak_256 } = require_sha3(), hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""), unhex = (h) => {
  if (h = h.replace(/^0x/, ""), h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex");
  let o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
  return o;
}, utf8 = (s) => new TextEncoder().encode(s);
function eip191Hash(message) {
  let m = utf8(message), p = utf8(`Ethereum Signed Message:
` + m.length), b = new Uint8Array(p.length + m.length);
  return b.set(p), b.set(m, p.length), keccak_256(b);
}
function addressOfPublicKey(pub) {
  return "0x" + hex(keccak_256(pub.slice(1)).slice(-20));
}
function recoverAddress(message, signature) {
  let sig = unhex(signature);
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  let v = sig[64];
  if (v >= 27 && (v -= 27), v !== 0 && v !== 1) throw new Error("bad recovery id");
  let s = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v);
  if (s.hasHighS()) throw new Error("non-canonical signature");
  return addressOfPublicKey(s.recoverPublicKey(eip191Hash(message)).toRawBytes(!1));
}
function signPersonal(message, privHex) {
  let s = secp256k1.sign(eip191Hash(message), unhex(privHex));
  return "0x" + hex(s.toCompactRawBytes()) + (27 + s.recovery).toString(16).padStart(2, "0");
}
function addressOfPrivateKey(privHex) {
  return addressOfPublicKey(secp256k1.getPublicKey(unhex(privHex), !1));
}
function toChecksumAddress(addr) {
  let a = String(addr).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(a)) throw new Error("bad address");
  let h = hex(keccak_256(utf8(a)));
  return "0x" + Array.from(a, (c, i) => parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c).join("");
}
module.exports = { toChecksumAddress, recoverAddress, eip191Hash: (m) => hex(eip191Hash(m)), signPersonal, addressOfPrivateKey };
