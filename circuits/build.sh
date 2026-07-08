set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"

mkdir -p build
echo "==> compiling circuit"
circom src/withdraw.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build

cd build
if [ ! -f pot_final.ptau ]; then
  echo "==> powers of tau (2^15, dev ceremony)"
  npx snarkjs powersoftau new bn128 15 pot_0.ptau
  npx snarkjs powersoftau contribute pot_0.ptau pot_1.ptau --name=olio -e="olio $(date +%s%N)"
  npx snarkjs powersoftau prepare phase2 pot_1.ptau pot_final.ptau
fi

echo "==> groth16 setup"
npx snarkjs groth16 setup withdraw.r1cs pot_final.ptau withdraw_0.zkey
npx snarkjs zkey contribute withdraw_0.zkey withdraw_final.zkey --name=olio2 -e="olio $(date +%s%N)"
npx snarkjs zkey export verificationkey withdraw_final.zkey verification_key.json

echo "==> test vector + fixture"
node ../gen_input.mjs
npx snarkjs groth16 fullprove input.json withdraw_js/withdraw.wasm withdraw_final.zkey proof.json public.json
npx snarkjs groth16 verify verification_key.json public.json proof.json
node to_soroban.mjs   # writes programs/olio-pool/src/fixture.rs + vk_soroban.json

echo "==> staging frontend proving assets"
mkdir -p ../../frontend/public/zk
cp withdraw_js/withdraw.wasm ../../frontend/public/zk/withdraw.wasm
cp withdraw_final.zkey ../../frontend/public/zk/withdraw.zkey
cp verification_key.json ../../frontend/public/zk/verification_key.json
echo "circuit build complete"
