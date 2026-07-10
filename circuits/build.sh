set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"

mkdir -p build
echo "==> compiling circuits"
circom src/withdraw.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build
circom src/transfer.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build

cd build
if [ ! -f pot_final.ptau ]; then
  echo "==> powers of tau (2^15, dev ceremony)"
  npx snarkjs powersoftau new bn128 15 pot_0.ptau
  npx snarkjs powersoftau contribute pot_0.ptau pot_1.ptau --name=olio -e="olio $(date +%s%N)"
  npx snarkjs powersoftau prepare phase2 pot_1.ptau pot_final.ptau
fi

# Groth16 setup is non-deterministic (random contribution), so a fresh zkey
# changes the VK and invalidates any committed proof fixtures bound to it. Only
# run setup when the zkey is missing; committed zkeys are reused as-is.
if [ ! -f withdraw_final.zkey ]; then
  echo "==> groth16 setup (withdraw)"
  npx snarkjs groth16 setup withdraw.r1cs pot_final.ptau withdraw_0.zkey
  npx snarkjs zkey contribute withdraw_0.zkey withdraw_final.zkey --name=olio2 -e="olio $(date +%s%N)"
fi
npx snarkjs zkey export verificationkey withdraw_final.zkey verification_key.json

if [ ! -f transfer_final.zkey ]; then
  echo "==> groth16 setup (transfer)"
  npx snarkjs groth16 setup transfer.r1cs pot_final.ptau transfer_0.zkey
  npx snarkjs zkey contribute transfer_0.zkey transfer_final.zkey --name=olio2 -e="olio $(date +%s%N)"
fi
npx snarkjs zkey export verificationkey transfer_final.zkey verification_key_transfer.json

echo "==> test vector + fixture (withdraw)"
node ../gen_input.mjs
npx snarkjs groth16 fullprove input.json withdraw_js/withdraw.wasm withdraw_final.zkey proof.json public.json
npx snarkjs groth16 verify verification_key.json public.json proof.json
node to_soroban.mjs   # writes programs/olio-pool/src/fixture.rs + vk_soroban.json

echo "==> test vector + fixture (transfer)"
node ../gen_transfer_input.mjs
npx snarkjs groth16 fullprove input_transfer.json transfer_js/transfer.wasm transfer_final.zkey proof_transfer.json public_transfer.json
npx snarkjs groth16 verify verification_key_transfer.json public_transfer.json proof_transfer.json
node ../to_soroban_transfer.mjs   # writes programs/olio-pool/src/transfer_fixture.rs + vk_transfer_soroban.json

echo "==> staging web proving assets"
mkdir -p ../../web/public/zk
cp withdraw_js/withdraw.wasm ../../web/public/zk/withdraw.wasm
cp withdraw_final.zkey ../../web/public/zk/withdraw.zkey
cp verification_key.json ../../web/public/zk/verification_key.json
cp transfer_js/transfer.wasm ../../web/public/zk/transfer.wasm
cp transfer_final.zkey ../../web/public/zk/transfer.zkey
cp verification_key_transfer.json ../../web/public/zk/verification_key_transfer.json
echo "circuit build complete"
