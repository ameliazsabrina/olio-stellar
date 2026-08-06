import { buildPoseidon } from "circomlibjs";
import { writeFileSync } from "fs";

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (values) => F.toObject(poseidon(values));

const ownerSecret = 111111111111n;
const ownerPk = H([ownerSecret]);
const salt = 222222222222n;
const amount = 50000000n;
const commitment = H([amount, ownerPk, salt]);

writeFileSync("input_deposit.json", JSON.stringify({
  commitment: commitment.toString(),
  amount: amount.toString(),
  ownerPk: ownerPk.toString(),
  salt: salt.toString(),
}, null, 2));

const wdOwnerSecret = 987654321987654321n;
const wdOwnerPk = H([wdOwnerSecret]);
const wdSalt = 123456789123456789n;
const wdCommitment = H([amount, wdOwnerPk, wdSalt]);
writeFileSync("input_deposit_wd.json", JSON.stringify({
  commitment: wdCommitment.toString(),
  amount: amount.toString(),
  ownerPk: wdOwnerPk.toString(),
  salt: wdSalt.toString(),
}, null, 2));
