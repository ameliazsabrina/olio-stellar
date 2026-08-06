import { readFileSync, writeFileSync } from "fs";

const vk = JSON.parse(readFileSync("verification_key_deposit.json"));
const proof = JSON.parse(readFileSync("proof_deposit.json"));
const publicSignals = JSON.parse(readFileSync("public_deposit.json"));
const wdProof = JSON.parse(readFileSync("proof_deposit_wd.json"));

const hex = (n, bytes) => BigInt(n).toString(16).padStart(bytes * 2, "0");
const g1 = (p) => hex(p[0], 32) + hex(p[1], 32);
const g2 = (p) =>
  hex(p[0][1], 32) + hex(p[0][0], 32) +
  hex(p[1][1], 32) + hex(p[1][0], 32);

let out = "";
out += `pub const DP_VK_ALPHA: &str = "${g1(vk.vk_alpha_1)}";\n`;
out += `pub const DP_VK_BETA: &str = "${g2(vk.vk_beta_2)}";\n`;
out += `pub const DP_VK_GAMMA: &str = "${g2(vk.vk_gamma_2)}";\n`;
out += `pub const DP_VK_DELTA: &str = "${g2(vk.vk_delta_2)}";\n`;
out += "pub const DP_VK_IC: [&str; 3] = [\n";
for (const point of vk.IC) out += `    "${g1(point)}",\n`;
out += "];\n\n";
out += `pub const DP_PROOF_A: &str = "${g1(proof.pi_a)}";\n`;
out += `pub const DP_PROOF_B: &str = "${g2(proof.pi_b)}";\n`;
out += `pub const DP_PROOF_C: &str = "${g1(proof.pi_c)}";\n`;
out += `pub const DP_WD_PROOF_A: &str = "${g1(wdProof.pi_a)}";\n`;
out += `pub const DP_WD_PROOF_B: &str = "${g2(wdProof.pi_b)}";\n`;
out += `pub const DP_WD_PROOF_C: &str = "${g1(wdProof.pi_c)}";\n`;
out += `pub const DP_PUBLIC: [&str; 2] = ["${hex(publicSignals[0], 32)}", "${hex(publicSignals[1], 32)}"];\n`;

writeFileSync("../../programs/olio-pool/src/deposit_fixture.rs", out);

writeFileSync("vk_deposit_soroban.json", JSON.stringify({
  alpha: g1(vk.vk_alpha_1), beta: g2(vk.vk_beta_2), gamma: g2(vk.vk_gamma_2),
  delta: g2(vk.vk_delta_2), ic: vk.IC.map(g1),
}, null, 2));
