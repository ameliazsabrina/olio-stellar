import { buildPoseidon } from "circomlibjs";
import { writeFileSync } from "fs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const DEPTH = 20;
const R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const toStr = (x) => F.toObject(x).toString();
const H = (arr) => poseidon(arr);

// zeros
const zeros = [0n];
for (let i = 0; i < DEPTH; i++) zeros.push(F.toObject(H([zeros[i], zeros[i]])));

const ownerSecret = 111111111111n % R;
const salt = 222222222222n % R;
const amount = 50000000n;
const recipient = 12345n; // arbitrary for the fixture; live e2e uses keccak(strkey)%R

const ownerPk = F.toObject(H([ownerSecret]));
const commitment = F.toObject(H([amount, ownerPk, salt]));

// leaf 0: all pathIndices 0, siblings = zeros
let cur = commitment;
const pathElements = [],
  pathIndices = [];
for (let i = 0; i < DEPTH; i++) {
  pathElements.push(zeros[i].toString());
  pathIndices.push("0");
  cur = F.toObject(H([cur, zeros[i]]));
}
const root = cur;
const nullifier = F.toObject(H([ownerSecret, 0n]));

const input = {
  root: root.toString(),
  nullifier: nullifier.toString(),
  recipient: recipient.toString(),
  amount: amount.toString(),
  ownerSecret: ownerSecret.toString(),
  salt: salt.toString(),
  pathElements,
  pathIndices,
};
writeFileSync("build/input.json", JSON.stringify(input, null, 2));
console.log("commitment =", commitment.toString(16));
console.log("root       =", root.toString(16));
console.log("nullifier  =", nullifier.toString(16));
