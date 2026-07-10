pragma circom 2.1.6;

include "poseidon.circom";
include "bitify.circom";
include "mux1.circom";

// Poseidon Merkle inclusion. Folds `leaf` up `depth` levels using the sibling
// `pathElements` and direction bits `pathIndices` (0 = leaf on the left at that
// level, 1 = leaf on the right). Node hash matches the contract's
// poseidon_hash::<3, Bn254Fr>([left, right]). Identical to withdraw.circom.
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

// Shielded transfer (1-input / 2-output). Proves ownership + Merkle membership
// of one input note and derives its nullifier — exactly like Withdraw — then,
// instead of releasing a public amount, binds two *output* commitments: a note
// for the recipient and a change note back to the sender. Value is conserved
// (`inAmount == recipientAmount + changeAmount`) entirely in zero knowledge, so
// the contract inserts two commitments it cannot read without any value being
// created. Recipient identity (`recipientPk`) stays private; only the hiding
// output commitments are ever published.
template Transfer(depth) {
    // Public
    signal input root;
    signal input nullifier;
    signal input outCommitmentRecipient;
    signal input outCommitmentChange;
    // Private — input note
    signal input inAmount;
    signal input ownerSecret;
    signal input inSalt;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    // Private — outputs
    signal input recipientPk;
    signal input recipientAmount;
    signal input recipientSalt;
    signal input changeAmount;
    signal input changeSalt;

    // owner_pk = Poseidon([ownerSecret])
    component pk = Poseidon(1);
    pk.inputs[0] <== ownerSecret;

    // input commitment = Poseidon([inAmount, owner_pk, inSalt])
    component inCom = Poseidon(3);
    inCom.inputs[0] <== inAmount;
    inCom.inputs[1] <== pk.out;
    inCom.inputs[2] <== inSalt;

    // Membership: computed root must equal the public root.
    component mp = MerkleProof(depth);
    mp.leaf <== inCom.out;
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

    // Range-constrain every amount to 64 bits so the conservation sum can't wrap
    // the field. inAmount is also implied by membership, but constrain it too.
    component inBits = Num2Bits(64);
    inBits.in <== inAmount;
    component recBits = Num2Bits(64);
    recBits.in <== recipientAmount;
    component chgBits = Num2Bits(64);
    chgBits.in <== changeAmount;

    // Value conservation.
    inAmount === recipientAmount + changeAmount;

    // Output commitments, bound into the public signals.
    component outR = Poseidon(3);
    outR.inputs[0] <== recipientAmount;
    outR.inputs[1] <== recipientPk;
    outR.inputs[2] <== recipientSalt;
    outCommitmentRecipient === outR.out;

    component outC = Poseidon(3);
    outC.inputs[0] <== changeAmount;
    outC.inputs[1] <== pk.out;
    outC.inputs[2] <== changeSalt;
    outCommitmentChange === outC.out;
}

component main {public [root, nullifier, outCommitmentRecipient, outCommitmentChange]} = Transfer(20);
