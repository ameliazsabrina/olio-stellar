import { buildPoseidon } from "circomlibjs";
import pkg from "js-sha3";
const { keccak256 } = pkg;
import { writeFileSync } from "fs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const DEPTH = 20;
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const H = (a) => F.toObject(poseidon(a));
const RECIPIENT = process.argv[2];

const zeros = [0n];
for (let i = 0; i < DEPTH; i++) zeros.push(H([zeros[i], zeros[i]]));

const ownerSecret = 987654321987654321n % R;
const salt = 123456789123456789n % R;
const amount = 50000000n;
const recipient = BigInt("0x" + keccak256(new TextEncoder().encode(RECIPIENT))) % R;

const ownerPk = H([ownerSecret]);
const commitment = H([amount, ownerPk, salt]);
let cur = commitment;
const pathElements = [], pathIndices = [];
for (let i = 0; i < DEPTH; i++) { pathElements.push(zeros[i].toString()); pathIndices.push("0"); cur = H([cur, zeros[i]]); }
const root = cur;
const nullifier = H([ownerSecret, 0n]);

writeFileSync("build/wd_input.json", JSON.stringify({
  root: root.toString(), nullifier: nullifier.toString(), recipient: recipient.toString(),
  amount: amount.toString(), ownerSecret: ownerSecret.toString(), salt: salt.toString(),
  pathElements, pathIndices
}));
const hex32 = (x) => x.toString(16).padStart(64, "0");
writeFileSync("build/wd_meta.json", JSON.stringify({
  recipient: RECIPIENT, commitment: hex32(commitment), root: hex32(root),
  nullifier: hex32(nullifier), amount: amount.toString()
}));
console.log("recipient_fr =", recipient.toString());
console.log("commitment   =", hex32(commitment));
console.log("root         =", hex32(root));
