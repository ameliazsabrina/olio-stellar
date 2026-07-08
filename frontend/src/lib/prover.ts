import { toBE32 } from "./crypto";

export type WithdrawInput = {
  root: string;
  nullifier: string;
  recipient: string;
  amount: string;
  ownerSecret: string;
  salt: string;
  pathElements: string[];
  pathIndices: (string | number)[];
};

export type RawProof = { a: Uint8Array; b: Uint8Array; c: Uint8Array };

const g1 = (p: string[]) => concat(toBE32(BigInt(p[0])), toBE32(BigInt(p[1])));
// snarkjs G2 is [[x_c0, x_c1], [y_c0, y_c1]]; Soroban wants c1‖c0 per coordinate.
const g2 = (p: string[][]) =>
  concat(
    toBE32(BigInt(p[0][1])),
    toBE32(BigInt(p[0][0])),
    toBE32(BigInt(p[1][1])),
    toBE32(BigInt(p[1][0])),
  );

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

function encodeProof(proof: SnarkProof): RawProof {
  return { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };
}

/// Generate and serialize a withdraw proof. Returns timing so the UI can surface
/// proving performance (the PRD launch-gate metric).
export async function proveWithdraw(
  input: WithdrawInput,
): Promise<{ proof: RawProof; publicSignals: string[]; ms: number }> {
  const snarkjs = await import("snarkjs");
  const started = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/zk/withdraw.wasm",
    "/zk/withdraw.zkey",
  );
  return {
    proof: encodeProof(proof as SnarkProof),
    publicSignals,
    ms: performance.now() - started,
  };
}
