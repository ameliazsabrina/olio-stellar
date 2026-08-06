pragma circom 2.1.6;

include "poseidon.circom";
include "bitify.circom";

template Deposit() {
    signal input commitment;
    signal input amount;
    signal input ownerPk;
    signal input salt;

    component com = Poseidon(3);
    com.inputs[0] <== amount;
    com.inputs[1] <== ownerPk;
    com.inputs[2] <== salt;
    commitment === com.out;

    component amtBits = Num2Bits(64);
    amtBits.in <== amount;
}

component main {public [commitment, amount]} = Deposit();
