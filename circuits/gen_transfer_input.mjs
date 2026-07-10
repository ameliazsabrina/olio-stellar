import { buildPoseidon } from "circomlibjs";
import { writeFileSync } from "fs";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const DEPTH = 20;
const R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const H = (arr) => F.toObject(poseidon(arr));

// zeros[i] = empty subtree root at level i (empty leaf = field 0).
const zeros = [0n];
for (let i = 0; i < DEPTH; i++) zeros.push(H([zeros[i], zeros[i]]));

// Input note (spent), inserted at leaf 0 — same convention as gen_input.mjs.
const ownerSecret = 111111111111n % R;
const inSalt = 222222222222n % R;
const inAmount = 50000000n;

// Split: 30 USDC to recipient, 20 USDC change back to sender.
const recipientAmount = 30000000n;
const changeAmount = inAmount - recipientAmount;
const recipientSalt = 333333333333n % R;
const changeSalt = 444444444444n % R;
// Recipient's note pubkey. Arbitrary field for the fixture; live e2e uses the
// recipient's registered note_pubkey.
const recipientPk = 987654321n % R;

const ownerPk = H([ownerSecret]);
const inCommitment = H([inAmount, ownerPk, inSalt]);

// Membership of leaf 0: all pathIndices 0, siblings = zeros.
let cur = inCommitment;
const pathElements = [];
const pathIndices = [];
for (let i = 0; i < DEPTH; i++) {
  pathElements.push(zeros[i].toString());
  pathIndices.push("0");
  cur = H([cur, zeros[i]]);
}
const root = cur;
const nullifier = H([ownerSecret, 0n]);

const outCommitmentRecipient = H([recipientAmount, recipientPk, recipientSalt]);
const outCommitmentChange = H([changeAmount, ownerPk, changeSalt]);

const input = {
  root: root.toString(),
  nullifier: nullifier.toString(),
  outCommitmentRecipient: outCommitmentRecipient.toString(),
  outCommitmentChange: outCommitmentChange.toString(),
  inAmount: inAmount.toString(),
  ownerSecret: ownerSecret.toString(),
  inSalt: inSalt.toString(),
  pathElements,
  pathIndices,
  recipientPk: recipientPk.toString(),
  recipientAmount: recipientAmount.toString(),
  recipientSalt: recipientSalt.toString(),
  changeAmount: changeAmount.toString(),
  changeSalt: changeSalt.toString(),
};
writeFileSync("input_transfer.json", JSON.stringify(input, null, 2));

// Note-level values the Rust fixture needs (hex, 32-byte big-endian).
const hex = (x) => x.toString(16).padStart(64, "0");
const notes = {
  inCommitment: hex(inCommitment),
  root: hex(root),
  nullifier: hex(nullifier),
  recipientCommitment: hex(outCommitmentRecipient),
  changeCommitment: hex(outCommitmentChange),
  inAmount: inAmount.toString(),
  recipientAmount: recipientAmount.toString(),
  changeAmount: changeAmount.toString(),
};
writeFileSync("notes_transfer.json", JSON.stringify(notes, null, 2));
console.log("inCommitment      =", notes.inCommitment);
console.log("root              =", notes.root);
console.log("nullifier         =", notes.nullifier);
console.log("recipientCommit   =", notes.recipientCommitment);
console.log("changeCommit      =", notes.changeCommitment);
