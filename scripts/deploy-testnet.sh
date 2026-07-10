#!/usr/bin/env bash
# Build + deploy Olio (registry + shielded pool) to Stellar Testnet, wire them
# to Circle's testnet USDC, and write the resulting IDs into web/.env.local.
set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE_ACCOUNT="${1:-alice}"
NETWORK="${STELLAR_NETWORK:-testnet}"
# Circle-issued USDC on Stellar Testnet (override via env if it ever changes).
USDC_ISSUER="${USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}"
USDC_ASSET="USDC:${USDC_ISSUER}"
POOL_DEPTH="${POOL_DEPTH:-20}"

REGISTRY_WASM="target/wasm32v1-none/release/olio_registry.wasm"
POOL_WASM="target/wasm32v1-none/release/olio_pool.wasm"
ENV_FILE="web/.env.local"

log() { printf '\033[0;36m==>\033[0m %s\n' "$*"; }

# 1. Deployer identity.
if ! stellar keys address "${SOURCE_ACCOUNT}" >/dev/null 2>&1; then
  log "Creating and funding identity '${SOURCE_ACCOUNT}' on ${NETWORK}"
  stellar keys generate "${SOURCE_ACCOUNT}" --network "${NETWORK}" --fund
fi
ADMIN_ADDR=$(stellar keys address "${SOURCE_ACCOUNT}")
log "Deployer: ${ADMIN_ADDR}"

# 2. Build both contracts.
log "Building contracts"
stellar contract build

# 3. Resolve (and ensure deployed) the USDC Stellar Asset Contract.
USDC_SAC=$(stellar contract id asset --asset "${USDC_ASSET}" --network "${NETWORK}")
log "USDC SAC: ${USDC_SAC}"
if ! stellar contract info interface --id "${USDC_SAC}" --network "${NETWORK}" >/dev/null 2>&1; then
  log "USDC SAC not yet instantiated on ${NETWORK}; deploying wrapper"
  stellar contract asset deploy \
    --asset "${USDC_ASSET}" \
    --source "${SOURCE_ACCOUNT}" \
    --network "${NETWORK}" || true
fi

# 4. Deploy registry + pool.
log "Deploying olio-registry"
REGISTRY_ID=$(stellar contract deploy \
  --wasm "${REGISTRY_WASM}" \
  --source "${SOURCE_ACCOUNT}" \
  --network "${NETWORK}")
log "Registry: ${REGISTRY_ID}"

log "Deploying olio-pool"
POOL_ID=$(stellar contract deploy \
  --wasm "${POOL_WASM}" \
  --source "${SOURCE_ACCOUNT}" \
  --network "${NETWORK}")
log "Pool: ${POOL_ID}"

# 5. Initialize the pool with the USDC SAC.
log "Initializing pool (asset=USDC, depth=${POOL_DEPTH})"
stellar contract invoke \
  --id "${POOL_ID}" \
  --source "${SOURCE_ACCOUNT}" \
  --network "${NETWORK}" \
  -- initialize \
  --admin "${ADMIN_ADDR}" \
  --asset "${USDC_SAC}" \
  --depth "${POOL_DEPTH}"

# 6. Register the Groth16 verification key (from the circuit build).
VK_FILE="circuits/build/vk_soroban.json"
if [ ! -f "${VK_FILE}" ]; then
  echo "Missing ${VK_FILE}. Run circuits/build.sh first." >&2
  exit 1
fi
log "Setting Groth16 verifier key (withdraw)"
stellar contract invoke \
  --id "${POOL_ID}" \
  --source "${SOURCE_ACCOUNT}" \
  --network "${NETWORK}" \
  -- set_verifier_key \
  --admin "${ADMIN_ADDR}" \
  --vk "$(cat "${VK_FILE}")"

# 6a. Register the transfer (shielded send) Groth16 verification key.
VK_TRANSFER_FILE="circuits/build/vk_transfer_soroban.json"
if [ ! -f "${VK_TRANSFER_FILE}" ]; then
  echo "Missing ${VK_TRANSFER_FILE}. Run circuits/build.sh first." >&2
  exit 1
fi
log "Setting Groth16 verifier key (transfer)"
stellar contract invoke \
  --id "${POOL_ID}" \
  --source "${SOURCE_ACCOUNT}" \
  --network "${NETWORK}" \
  -- set_transfer_verifier_key \
  --admin "${ADMIN_ADDR}" \
  --vk "$(cat "${VK_TRANSFER_FILE}")"

# 6b. Build + upload the vendored passkey smart-wallet WASM. It lives in its own
# workspace (soroban-sdk 23, excluded from the root) and is uploaded, not
# instantiated — clients deploy a per-user smart-wallet instance from this hash
# (no factory contract).
log "Building + uploading passkey smart-wallet WASM"
( cd vendor/passkey-contracts && stellar contract build --package smart-wallet >/dev/null )
SMART_WALLET_WASM_HASH=$(stellar contract upload \
  --wasm vendor/passkey-contracts/target/wasm32v1-none/release/smart_wallet.wasm \
  --source "${SOURCE_ACCOUNT}" \
  --network "${NETWORK}")
log "Smart-wallet WASM hash: ${SMART_WALLET_WASM_HASH}"

# 7. Write web env.
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
log "Writing ${ENV_FILE}"
cat > "${ENV_FILE}" <<EOF
NEXT_PUBLIC_STELLAR_NETWORK=${NETWORK}
NEXT_PUBLIC_STELLAR_RPC_URL=${RPC_URL}
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE}"
NEXT_PUBLIC_OLIO_REGISTRY_ID=${REGISTRY_ID}
NEXT_PUBLIC_OLIO_POOL_ID=${POOL_ID}
NEXT_PUBLIC_USDC_SAC_ID=${USDC_SAC}
NEXT_PUBLIC_USDC_ISSUER=${USDC_ISSUER}
NEXT_PUBLIC_POOL_DEPTH=${POOL_DEPTH}
NEXT_PUBLIC_SMART_WALLET_WASM_HASH=${SMART_WALLET_WASM_HASH}
EOF

log "Done. Contract IDs written to ${ENV_FILE}:"
echo "  registry: ${REGISTRY_ID}"
echo "  pool:     ${POOL_ID}"
echo "  usdc SAC: ${USDC_SAC}"
