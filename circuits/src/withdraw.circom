pragma circom 2.1.6;

include "poseidon.circom";
include "bitify.circom";
include "mux1.circom";

// Poseidon Merkle inclusion. Folds `leaf` up `depth` levels using the sibling
// `pathElements` and direction bits `pathIndices` (0 = leaf on the left at that
// level, 1 = leaf on the right). Node hash matches the contract's
// poseidon_hash::<3, Bn254Fr>([left, right]).
template MerkleProof(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component muxL[depth];
    component muxR[depth];
    signal cur[depth + 1];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be a bit.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // left  = bit==0 ? cur : sibling
        muxL[i] = Mux1();
        muxL[i].c[0] <== cur[i];
        muxL[i].c[1] <== pathElements[i];
        muxL[i].s <== pathIndices[i];

        // right = bit==0 ? sibling : cur
        muxR[i] = Mux1();
        muxR[i].c[0] <== pathElements[i];
        muxR[i].c[1] <== cur[i];
        muxR[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxL[i].out;
        hashers[i].inputs[1] <== muxR[i].out;
        cur[i + 1] <== hashers[i].out;
    }

    root <== cur[depth];
}

// Proves ownership of a note whose commitment sits in the pool's Merkle tree,
// and derives its one-time nullifier — all in zero knowledge. Public signals
// are the only thing the contract sees.
template Withdraw(depth) {
    // Public
    signal input root;
    signal input nullifier;
    signal input recipient;
    signal input amount;
    // Private
    signal input ownerSecret;
    signal input salt;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // owner_pk = Poseidon([ownerSecret])
    component pk = Poseidon(1);
    pk.inputs[0] <== ownerSecret;

    // commitment = Poseidon([amount, owner_pk, salt])
    component com = Poseidon(3);
    com.inputs[0] <== amount;
    com.inputs[1] <== pk.out;
    com.inputs[2] <== salt;

    // Membership: computed root must equal the public root.
    component mp = MerkleProof(depth);
    mp.leaf <== com.out;
    for (var i = 0; i < depth; i++) {
        mp.pathElements[i] <== pathElements[i];
        mp.pathIndices[i] <== pathIndices[i];
    }
    root === mp.root;

    // leaf_index = Σ pathIndices[i] * 2^i
    component leafIndex = Bits2Num(depth);
    for (var i = 0; i < depth; i++) {
        leafIndex.in[i] <== pathIndices[i];
    }

    // nullifier = Poseidon([ownerSecret, leaf_index])
    component nf = Poseidon(2);
    nf.inputs[0] <== ownerSecret;
    nf.inputs[1] <== leafIndex.out;
    nullifier === nf.out;

    // amount is a positive 64-bit value.
    component amtBits = Num2Bits(64);
    amtBits.in <== amount;

    // Bind `recipient` into the proof so it can't be swapped by a front-runner.
    signal recipientSq;
    recipientSq <== recipient * recipient;
}

component main {public [root, nullifier, recipient, amount]} = Withdraw(20);
