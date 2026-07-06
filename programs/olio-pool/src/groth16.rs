//! Minimal Groth16 verifier over BN254, using Soroban's native bn254 host
//! functions. Structure ports the stellar/soroban-examples `groth16_verifier`
//! (BLS12-381) to BN254 — the curve snarkjs/Circom emit natively, so proofs from
//! snarkjs are consumed without conversion.
//!
//! Serialization (host-enforced, uncompressed big-endian):
//! - G1 = 64 bytes  (X‖Y)
//! - G2 = 128 bytes (Fp2 coords, each c0(real)‖c1(imaginary))
//! - Fr = 32 bytes  (big-endian)

use soroban_sdk::{
    contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    /// One G1 point per public signal, plus a constant term `ic[0]`.
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

/// Verify a Groth16 proof for the given public signals.
///
/// Checks `e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1`,
/// where `vk_x = ic[0] + Σ pub_signals[i] · ic[i+1]`.
pub fn verify(
    env: &Env,
    vk: &VerificationKey,
    proof: &Proof,
    pub_signals: &Vec<Bn254Fr>,
) -> bool {
    // ic must have exactly one entry per public signal, plus the constant.
    if vk.ic.len() != pub_signals.len() + 1 {
        return false;
    }
    let bn = env.crypto().bn254();

    // vk_x = ic[0] + MSM(ic[1..], pub_signals)
    let mut points = Vec::new(env);
    let mut scalars = Vec::new(env);
    for i in 0..pub_signals.len() {
        points.push_back(Bn254G1Affine::from_bytes(vk.ic.get(i + 1).unwrap()));
        scalars.push_back(pub_signals.get(i).unwrap());
    }
    let msm = bn.g1_msm(points, scalars);
    let vk_x = bn.g1_add(&Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap()), &msm);

    let a = Bn254G1Affine::from_bytes(proof.a.clone());
    let g1s = vec![
        env,
        -&a,
        Bn254G1Affine::from_bytes(vk.alpha.clone()),
        vk_x,
        Bn254G1Affine::from_bytes(proof.c.clone()),
    ];
    let g2s = vec![
        env,
        Bn254G2Affine::from_bytes(proof.b.clone()),
        Bn254G2Affine::from_bytes(vk.beta.clone()),
        Bn254G2Affine::from_bytes(vk.gamma.clone()),
        Bn254G2Affine::from_bytes(vk.delta.clone()),
    ];
    bn.pairing_check(g1s, g2s)
}
