// Reproduce frontend/src/lib/crypto.ts byte layouts and print vectors for a
// fixed note, so we can pin them into a Rust test and compare the empty-tree
// root against the on-chain value.
const { keccak256 } = require("js-sha3");

const keccak = (...chunks) => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return new Uint8Array(keccak256.arrayBuffer(out));
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const i128BE = (v) => { const o = new Uint8Array(16); let x = BigInt(v); for (let i = 15; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const u64BE = (v) => { const o = new Uint8Array(8); let x = BigInt(v); for (let i = 7; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const zerosRoot = (depth) => { let z = keccak(new TextEncoder().encode("olio:empty-leaf:v1")); for (let i = 0; i < depth; i++) z = keccak(z, z); return z; };

const secret = new Uint8Array(32).fill(1);
const salt = new Uint8Array(32).fill(2);
const amount = 50000000n; // 5 USDC, 7 decimals
const leafIndex = 0;

const ownerPk = keccak(secret);
const commitment = keccak(i128BE(amount), ownerPk, salt);
const nullifier = keccak(secret, u64BE(leafIndex));

console.log("owner_pk   =", hex(ownerPk));
console.log("commitment =", hex(commitment));
console.log("nullifier  =", hex(nullifier));
console.log("zeros_root20 =", hex(zerosRoot(20)));
