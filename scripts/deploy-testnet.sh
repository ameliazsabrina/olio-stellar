#!/usr/bin/env bash
# Preservation-oriented Olio Testnet deployment. Reuses the configured registry
# unless --new-registry is explicit, stages config, and writes a redacted resume manifest.
set +x
set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE_ACCOUNT="${SOURCE_ACCOUNT:-alice}"
NETWORK="${STELLAR_NETWORK:-testnet}"
ENV_FILE="${DEPLOY_ENV_FILE:-web/.env.local}"
MANIFEST_FILE="${DEPLOY_MANIFEST_FILE:-artifacts/testnet-certification/deployment-manifest.json}"
RESUME_MANIFEST=""
EXISTING_REGISTRY_ID="${EXISTING_REGISTRY_ID:-}"
NEW_REGISTRY=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-testnet.sh [options]
  --source-account NAME   Stellar CLI deployer identity (default: alice)
                          Set ADMIN_ADDRESS=G... to make a different (e.g. multisig) account the pool admin
  --registry-id C...      Reuse and verify an existing registry
  --new-registry          Explicitly deploy a fresh, empty registry
  --env-file PATH         Environment file to stage and atomically activate
  --manifest PATH         Redacted resumable manifest path
  --resume PATH           Resume from a prior manifest
  --dry-run               Validate and describe; do not build, fund, or deploy
  -h, --help              Show this help

Required environment: FEE_RECIPIENT (an Olio-controlled test treasury G-address).
The dedicated fee signer is generated and staged privately when its secret is absent.
This command is testnet-only and never resets a database or existing contract.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-account) SOURCE_ACCOUNT="$2"; shift 2 ;;
    --registry-id) EXISTING_REGISTRY_ID="$2"; shift 2 ;;
    --new-registry) NEW_REGISTRY=1; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --manifest) MANIFEST_FILE="$2"; shift 2 ;;
    --resume) RESUME_MANIFEST="$2"; MANIFEST_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

USDC_ISSUER="${USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}"
USDC_ASSET="USDC:${USDC_ISSUER}"
POOL_DEPTH="${POOL_DEPTH:-20}"
FEE_RECIPIENT="${FEE_RECIPIENT:-}"
FEE_QUOTE_SIGNER_PUBLIC_KEY="${FEE_QUOTE_SIGNER_PUBLIC_KEY:-}"
FEE_QUOTE_SIGNING_SECRET="${FEE_QUOTE_SIGNING_SECRET:-}"
CCTP_OPERATOR="${CCTP_OPERATOR:-cctp-operator}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
PENDING_ENV_FILE="${ENV_FILE}.pending"

REGISTRY_WASM="target/wasm32v1-none/release/olio_registry.wasm"
POOL_WASM="target/wasm32v1-none/release/olio_pool.wasm"
INTAKE_WASM="target/wasm32v1-none/release/olio_intake.wasm"
SMART_WALLET_WASM="vendor/passkey-contracts/target/wasm32v1-none/release/smart_wallet.wasm"
VK_DEPOSIT_FILE="circuits/build/vk_deposit_soroban.json"
VK_WITHDRAW_FILE="circuits/build/vk_soroban.json"
VK_TRANSFER_FILE="circuits/build/vk_transfer_soroban.json"

REGISTRY_ID=""
POOL_ID=""
INTAKE_ID=""
SMART_WALLET_WASM_HASH=""
USDC_SAC=""
ADMIN_ADDR=""
OPERATOR_ADDR=""
OPERATOR_SECRET=""
SIGNER_G_ADDRESS=""
STATUS="validated"

log() { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
fail() { echo "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"; }

read_env_value() {
  [ -f "$1" ] || return 0
  awk -v key="$2" '$0 ~ "^" key "=" { sub("^[^=]*=", ""); gsub(/^\"|\"$/, ""); gsub(/^'"'"'|'"'"'$/, ""); print; exit }' "$1"
}

read_manifest_value() {
  [ -f "$1" ] || return 0
  node --input-type=module - "$1" "$2" <<'NODE'
import fs from "node:fs";
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const value = process.argv[3].split(".").reduce((item, key) => item?.[key], manifest);
if (value !== undefined && value !== null) process.stdout.write(String(value));
NODE
}

validate_address() {
  ADDRESS_KIND="$1" ADDRESS_VALUE="$2" node --input-type=module <<'NODE'
import { StrKey } from "./web/node_modules/@stellar/stellar-sdk/lib/index.js";
const valid = process.env.ADDRESS_KIND === "G"
  ? StrKey.isValidEd25519PublicKey(process.env.ADDRESS_VALUE)
  : StrKey.isValidContract(process.env.ADDRESS_VALUE);
if (!valid) process.exit(1);
NODE
}

derive_signer() {
  SIGNER_SECRET_VALUE="$1" node --input-type=module <<'NODE'
import { Keypair } from "./web/node_modules/@stellar/stellar-sdk/lib/index.js";
const keypair = Keypair.fromSecret(process.env.SIGNER_SECRET_VALUE);
process.stdout.write(`${keypair.rawPublicKey().toString("hex")}\n${keypair.publicKey()}\n`);
NODE
}

generate_signer() {
  node --input-type=module <<'NODE'
import { Keypair } from "./web/node_modules/@stellar/stellar-sdk/lib/index.js";
const keypair = Keypair.random();
process.stdout.write(`${keypair.secret()}\n${keypair.rawPublicKey().toString("hex")}\n${keypair.publicKey()}\n`);
NODE
}

generate_session_key() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
}

route_manifest() {
  EXISTING_MANIFEST="$1" MANIFEST_POOL="$2" MANIFEST_INTAKE="$3" node --input-type=module <<'NODE'
let existing = null;
try { existing = JSON.parse(process.env.EXISTING_MANIFEST || "null"); } catch {}
const pool = process.env.MANIFEST_POOL;
const intake = process.env.MANIFEST_INTAKE;
const fresh = {
  network: "testnet", pool, intake, routing: "intake-v1", evidence: "uncertified",
  routes: [0, 1, 3, 5, 6].map((domain) => ({ domain, eligible: true, certified: false })),
};
const reusable = existing && existing.pool === pool && existing.intake === intake && Array.isArray(existing.routes);
process.stdout.write(JSON.stringify(reusable ? existing : fresh));
NODE
}

upsert_env_file() {
  local file="$1" key="$2" value="$3" tmp
  tmp=$(mktemp "${file}.XXXXXX")
  if [ -f "$file" ]; then
    UPSERT_VALUE="$value" awk -v key="$key" \
      'BEGIN { found=0 } $0 ~ "^" key "=" { print key "=" ENVIRON["UPSERT_VALUE"]; found=1; next } { print } END { if (!found) print key "=" ENVIRON["UPSERT_VALUE"] }' \
      "$file" > "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" > "$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

write_manifest() {
  mkdir -p "$(dirname "$MANIFEST_FILE")"
  MANIFEST_PATH="$MANIFEST_FILE" MANIFEST_STATUS="$STATUS" MANIFEST_REGISTRY="$REGISTRY_ID" \
  MANIFEST_POOL="$POOL_ID" MANIFEST_INTAKE="$INTAKE_ID" MANIFEST_USDC="$USDC_SAC" \
  MANIFEST_ADMIN="$ADMIN_ADDR" MANIFEST_OPERATOR="$OPERATOR_ADDR" \
  MANIFEST_TREASURY="$FEE_RECIPIENT" MANIFEST_SIGNER="$FEE_QUOTE_SIGNER_PUBLIC_KEY" \
  MANIFEST_WALLET_HASH="$SMART_WALLET_WASM_HASH" \
  MANIFEST_REUSED="$([ "$NEW_REGISTRY" -eq 0 ] && printf true || printf false)" \
  MANIFEST_REGISTRY_HASH="$(test -f "$REGISTRY_WASM" && LC_ALL=C LANG=C shasum -a 256 "$REGISTRY_WASM" | awk '{print $1}')" \
  MANIFEST_POOL_HASH="$(test -f "$POOL_WASM" && LC_ALL=C LANG=C shasum -a 256 "$POOL_WASM" | awk '{print $1}')" \
  MANIFEST_INTAKE_HASH="$(test -f "$INTAKE_WASM" && LC_ALL=C LANG=C shasum -a 256 "$INTAKE_WASM" | awk '{print $1}')" \
  node --input-type=module <<'NODE'
import fs from "node:fs";
let old = {};
try { old = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8")); } catch {}
const output = {
  schemaVersion: 1,
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  status: process.env.MANIFEST_STATUS,
  updatedAt: new Date().toISOString(),
  registryReused: process.env.MANIFEST_REUSED === "true",
  contracts: {
    registry: process.env.MANIFEST_REGISTRY || null,
    pool: process.env.MANIFEST_POOL || null,
    intake: process.env.MANIFEST_INTAKE || null,
    usdcSac: process.env.MANIFEST_USDC || null,
  },
  publicIdentities: {
    admin: process.env.MANIFEST_ADMIN || null,
    cctpOperator: process.env.MANIFEST_OPERATOR || null,
    feeRecipient: process.env.MANIFEST_TREASURY || null,
    feeQuoteSigner: process.env.MANIFEST_SIGNER || null,
  },
  artifacts: {
    registryWasmSha256: process.env.MANIFEST_REGISTRY_HASH || null,
    poolWasmSha256: process.env.MANIFEST_POOL_HASH || null,
    intakeWasmSha256: process.env.MANIFEST_INTAKE_HASH || null,
    smartWalletWasmHash: process.env.MANIFEST_WALLET_HASH || null,
  },
  // CLI v27 returns contract IDs, not submission hashes. Certification fills these
  // from confirmed Horizon/RPC evidence rather than guessing from local output.
  deploymentTransactions: old.deploymentTransactions ?? {
    registry: null, pool: null, intake: null, smartWalletUpload: null,
  },
  deploymentLedgers: old.deploymentLedgers ?? { pool: null, intake: null },
};
fs.writeFileSync(process.env.MANIFEST_PATH, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o644 });
NODE
}

verify_interface() {
  local contract_id="$1" method="$2" output
  output=$(mktemp)
  if ! stellar contract info interface --id "$contract_id" --network "$NETWORK" > "$output" 2>/dev/null; then
    rm -f "$output"; fail "Unable to read deployed interface for ${contract_id}."
  fi
  grep -q "$method" "$output" || { rm -f "$output"; fail "Contract ${contract_id} lacks required method ${method}."; }
  rm -f "$output"
}

# Static local validation precedes account funding and deployment.
for command in stellar node awk shasum; do require_command "$command"; done
[ "$NETWORK" = "testnet" ] || fail "This deployment command only accepts STELLAR_NETWORK=testnet."
case "$POOL_DEPTH" in ''|*[!0-9]*) fail "POOL_DEPTH must be an integer from 1 through 32." ;; esac
[ "$POOL_DEPTH" -ge 1 ] && [ "$POOL_DEPTH" -le 32 ] || fail "POOL_DEPTH must be from 1 through 32."
validate_address G "$USDC_ISSUER" || fail "USDC_ISSUER must be a valid G-address."
validate_address G "$FEE_RECIPIENT" || fail "FEE_RECIPIENT must be a valid Olio-controlled G-address."
[ "$NEW_REGISTRY" -eq 0 ] || [ -z "$EXISTING_REGISTRY_ID" ] || fail "Choose --registry-id or --new-registry, not both."
for verifier_file in "$VK_DEPOSIT_FILE" "$VK_WITHDRAW_FILE" "$VK_TRANSFER_FILE"; do
  [ -f "$verifier_file" ] || fail "Missing ${verifier_file}. Run circuits/build.sh first."
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$verifier_file" || fail "Invalid verifier JSON: ${verifier_file}"
done

if [ -n "$RESUME_MANIFEST" ]; then
  [ -f "$RESUME_MANIFEST" ] || fail "Resume manifest does not exist: ${RESUME_MANIFEST}"
  [ "$(read_manifest_value "$RESUME_MANIFEST" network)" = "testnet" ] || fail "Resume manifest is not for testnet."
  REGISTRY_ID="$(read_manifest_value "$RESUME_MANIFEST" contracts.registry)"
  POOL_ID="$(read_manifest_value "$RESUME_MANIFEST" contracts.pool)"
  INTAKE_ID="$(read_manifest_value "$RESUME_MANIFEST" contracts.intake)"
  USDC_SAC="$(read_manifest_value "$RESUME_MANIFEST" contracts.usdcSac)"
  SMART_WALLET_WASM_HASH="$(read_manifest_value "$RESUME_MANIFEST" artifacts.smartWalletWasmHash)"
  [ -n "$FEE_QUOTE_SIGNER_PUBLIC_KEY" ] || FEE_QUOTE_SIGNER_PUBLIC_KEY="$(read_manifest_value "$RESUME_MANIFEST" publicIdentities.feeQuoteSigner)"
  EXISTING_REGISTRY_ID="$REGISTRY_ID"
  NEW_REGISTRY=0
fi

for resumed_contract in "$POOL_ID" "$INTAKE_ID" "$USDC_SAC"; do
  [ -z "$resumed_contract" ] || validate_address C "$resumed_contract" || fail "Resume manifest contains an invalid contract address."
done
[ -z "$SMART_WALLET_WASM_HASH" ] || [[ "$SMART_WALLET_WASM_HASH" =~ ^[a-fA-F0-9]{64}$ ]] || fail "Resume manifest contains an invalid smart-wallet WASM hash."

if [ -z "$EXISTING_REGISTRY_ID" ] && [ "$NEW_REGISTRY" -eq 0 ]; then
  EXISTING_REGISTRY_ID="$(read_env_value "$ENV_FILE" NEXT_PUBLIC_OLIO_REGISTRY_ID)"
fi
if [ "$NEW_REGISTRY" -eq 0 ]; then
  [ -n "$EXISTING_REGISTRY_ID" ] || fail "No registry configured. Pass --registry-id C... or explicitly pass --new-registry."
  validate_address C "$EXISTING_REGISTRY_ID" || fail "Registry must be a valid C-address."
fi

[ -n "$FEE_QUOTE_SIGNING_SECRET" ] || FEE_QUOTE_SIGNING_SECRET="$(read_env_value "$PENDING_ENV_FILE" FEE_QUOTE_SIGNING_SECRET)"
[ -n "$FEE_QUOTE_SIGNING_SECRET" ] || FEE_QUOTE_SIGNING_SECRET="$(read_env_value "$ENV_FILE" FEE_QUOTE_SIGNING_SECRET)"
if [ -n "$FEE_QUOTE_SIGNING_SECRET" ]; then
  SIGNER_VALUES="$(derive_signer "$FEE_QUOTE_SIGNING_SECRET")" || fail "FEE_QUOTE_SIGNING_SECRET is invalid."
  DERIVED_PUBLIC="$(printf '%s\n' "$SIGNER_VALUES" | sed -n '1p')"
  SIGNER_G_ADDRESS="$(printf '%s\n' "$SIGNER_VALUES" | sed -n '2p')"
  if [ -n "$FEE_QUOTE_SIGNER_PUBLIC_KEY" ]; then
    EXPECTED_PUBLIC="$(printf '%s' "$FEE_QUOTE_SIGNER_PUBLIC_KEY" | tr '[:upper:]' '[:lower:]')"
    [ "$DERIVED_PUBLIC" = "$EXPECTED_PUBLIC" ] || fail "Signer secret and public key do not match."
  fi
  FEE_QUOTE_SIGNER_PUBLIC_KEY="$DERIVED_PUBLIC"
elif [ -n "$RESUME_MANIFEST" ] && [ -n "$POOL_ID" ]; then
  fail "Resume requires the original FEE_QUOTE_SIGNING_SECRET in the environment or pending environment file."
elif [ -n "$FEE_QUOTE_SIGNER_PUBLIC_KEY" ]; then
  fail "A signer secret is required to deploy a new pool."
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'Testnet deployment dry run\n  source: %s\n  registry: %s\n  pool/intake: %s\n  env activation: %s\n  manifest: %s\nNo build, funding, deployment, upload, or write was performed.\n' \
    "$SOURCE_ACCOUNT" "$([ "$NEW_REGISTRY" -eq 1 ] && printf 'new (explicit)' || printf 'reuse %s' "$EXISTING_REGISTRY_ID")" \
    "$([ -n "$POOL_ID" ] && printf resume || printf 'new pair')" "$ENV_FILE" "$MANIFEST_FILE"
  exit 0
fi

# Build locally before making any network mutation.
log "Building contracts"
stellar contract build
# The vendored passkey bundle intentionally contains only its reproducible WASM
# artifact, not the upstream Cargo workspace, so it is verified below rather
# than rebuilt here.
for wasm_file in "$REGISTRY_WASM" "$POOL_WASM" "$INTAKE_WASM" "$SMART_WALLET_WASM"; do
  [ -f "$wasm_file" ] || fail "Missing build artifact: ${wasm_file}"
done

# Read-only compatibility checks happen before identities can be created or funded.
if [ "$NEW_REGISTRY" -eq 0 ]; then verify_interface "$EXISTING_REGISTRY_ID" username_of; fi
[ -z "$POOL_ID" ] || verify_interface "$POOL_ID" fee_config
[ -z "$INTAKE_ID" ] || verify_interface "$INTAKE_ID" deposit_to_pool

if ! stellar keys address "$SOURCE_ACCOUNT" >/dev/null 2>&1; then
  log "Creating and funding deployer identity '${SOURCE_ACCOUNT}'"
  stellar keys generate "$SOURCE_ACCOUNT" --network "$NETWORK" --fund
fi
# ADMIN_ADDRESS lets a multisig admin own the pool while SOURCE_ACCOUNT only pays
# for and submits the deployment; the constructor records the admin without auth.
ADMIN_ADDR="${ADMIN_ADDRESS:-$(stellar keys address "$SOURCE_ACCOUNT")}"
if ! stellar keys address "$CCTP_OPERATOR" >/dev/null 2>&1; then
  log "Creating and funding dedicated CCTP operator '${CCTP_OPERATOR}'"
  stellar keys generate "$CCTP_OPERATOR" --network "$NETWORK" --fund
fi
OPERATOR_ADDR=$(stellar keys address "$CCTP_OPERATOR")
OPERATOR_SECRET=$(stellar keys secret "$CCTP_OPERATOR")
validate_address G "$ADMIN_ADDR" || fail "Deployer identity is invalid."
validate_address G "$OPERATOR_ADDR" || fail "CCTP operator identity is invalid."

if [ -z "$FEE_QUOTE_SIGNING_SECRET" ]; then
  GENERATED_SIGNER="$(generate_signer)"
  FEE_QUOTE_SIGNING_SECRET="$(printf '%s\n' "$GENERATED_SIGNER" | sed -n '1p')"
  FEE_QUOTE_SIGNER_PUBLIC_KEY="$(printf '%s\n' "$GENERATED_SIGNER" | sed -n '2p')"
  SIGNER_G_ADDRESS="$(printf '%s\n' "$GENERATED_SIGNER" | sed -n '3p')"
  log "Generated and privately staged a dedicated fee quote signer"
fi

for pair in "$FEE_RECIPIENT:$ADMIN_ADDR" "$FEE_RECIPIENT:$OPERATOR_ADDR" "$FEE_RECIPIENT:$SIGNER_G_ADDRESS" "$ADMIN_ADDR:$OPERATOR_ADDR" "$ADMIN_ADDR:$SIGNER_G_ADDRESS" "$OPERATOR_ADDR:$SIGNER_G_ADDRESS"; do
  [ "${pair%%:*}" != "${pair#*:}" ] || fail "Treasury, deployer, CCTP operator, and fee signer must be independent identities."
done

mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$PENDING_ENV_FILE" ]; then
  if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$PENDING_ENV_FILE"; else : > "$PENDING_ENV_FILE"; fi
fi
chmod 600 "$PENDING_ENV_FILE"
upsert_env_file "$PENDING_ENV_FILE" FEE_QUOTE_SIGNING_SECRET "$FEE_QUOTE_SIGNING_SECRET"
upsert_env_file "$PENDING_ENV_FILE" CCTP_OPERATOR_SECRET "$OPERATOR_SECRET"

[ -n "$USDC_SAC" ] || USDC_SAC=$(stellar contract id asset --asset "$USDC_ASSET" --network "$NETWORK")
validate_address C "$USDC_SAC" || fail "Derived USDC SAC is invalid."
if ! stellar contract info interface --id "$USDC_SAC" --network "$NETWORK" >/dev/null 2>&1; then
  log "Instantiating the testnet USDC SAC"
  stellar contract asset deploy --asset "$USDC_ASSET" --source "$SOURCE_ACCOUNT" --network "$NETWORK"
fi

if [ -z "$REGISTRY_ID" ]; then
  if [ "$NEW_REGISTRY" -eq 1 ]; then
    log "Deploying fresh registry (explicitly requested)"
    REGISTRY_ID=$(stellar contract deploy --wasm "$REGISTRY_WASM" --source "$SOURCE_ACCOUNT" --network "$NETWORK")
  else
    REGISTRY_ID="$EXISTING_REGISTRY_ID"
    log "Reusing registry ${REGISTRY_ID}"
  fi
fi
verify_interface "$REGISTRY_ID" username_of
STATUS="registry_ready"; write_manifest

if [ -z "$POOL_ID" ]; then
  log "Deploying signed-fee pool"
  POOL_ID=$(stellar contract deploy --wasm "$POOL_WASM" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- \
    --admin "$ADMIN_ADDR" --asset "$USDC_SAC" --fee_recipient "$FEE_RECIPIENT" \
    --fee_quote_signer "$FEE_QUOTE_SIGNER_PUBLIC_KEY" --depth "$POOL_DEPTH" \
    --deposit_vk "$(<"$VK_DEPOSIT_FILE")" --withdraw_vk "$(<"$VK_WITHDRAW_FILE")" --transfer_vk "$(<"$VK_TRANSFER_FILE")")
fi
verify_interface "$POOL_ID" fee_config
FEE_CONFIG_JSON=$(stellar contract invoke --id "$POOL_ID" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- fee_config)
CONFIG_JSON="$FEE_CONFIG_JSON" EXPECTED_SIGNER="$FEE_QUOTE_SIGNER_PUBLIC_KEY" node --input-type=module <<'NODE'
const config = JSON.parse(process.env.CONFIG_JSON);
const values = [];
const visit = (value) => {
  if (typeof value === "string") values.push(value.toLowerCase().replace(/^0x/, ""));
  else if (Array.isArray(value)) value.forEach(visit);
  else if (value && typeof value === "object") Object.values(value).forEach(visit);
};
visit(config.signer ?? config);
if (!values.includes(process.env.EXPECTED_SIGNER.toLowerCase())) process.exit(1);
NODE
STATUS="pool_ready"; write_manifest

if [ -z "$SMART_WALLET_WASM_HASH" ]; then
  log "Uploading passkey smart-wallet WASM"
  SMART_WALLET_WASM_HASH=$(stellar contract upload --wasm "$SMART_WALLET_WASM" --source "$SOURCE_ACCOUNT" --network "$NETWORK")
fi
STATUS="wallet_uploaded"; write_manifest

if [ -z "$INTAKE_ID" ]; then
  log "Deploying intake paired with pool ${POOL_ID}"
  INTAKE_ID=$(stellar contract deploy --wasm "$INTAKE_WASM" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- \
    --admin "$OPERATOR_ADDR" --pool "$POOL_ID" --asset "$USDC_SAC")
fi
verify_interface "$INTAKE_ID" deposit_to_pool
INTAKE_CONFIG_JSON=$(stellar contract invoke --id "$INTAKE_ID" --source "$SOURCE_ACCOUNT" --network "$NETWORK" -- config)
CONFIG_JSON="$INTAKE_CONFIG_JSON" EXPECTED_POOL="$POOL_ID" EXPECTED_ASSET="$USDC_SAC" EXPECTED_ADMIN="$OPERATOR_ADDR" node --input-type=module <<'NODE'
const body = JSON.stringify(JSON.parse(process.env.CONFIG_JSON));
for (const value of [process.env.EXPECTED_POOL, process.env.EXPECTED_ASSET, process.env.EXPECTED_ADMIN]) {
  if (!body.includes(value)) process.exit(1);
}
NODE
STATUS="contracts_verified"; write_manifest

# Stage all public values together, preserving unrelated secrets, then atomically activate.
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_STELLAR_NETWORK "$NETWORK"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_STELLAR_RPC_URL "$RPC_URL"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE "\"$NETWORK_PASSPHRASE\""
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_OLIO_REGISTRY_ID "$REGISTRY_ID"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_OLIO_POOL_ID "$POOL_ID"
upsert_env_file "$PENDING_ENV_FILE" MONGO_POOL_STORAGE_SCOPE "$POOL_ID"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_USDC_SAC_ID "$USDC_SAC"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_USDC_ISSUER "$USDC_ISSUER"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_POOL_DEPTH "$POOL_DEPTH"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_SMART_WALLET_WASM_HASH "$SMART_WALLET_WASM_HASH"
upsert_env_file "$PENDING_ENV_FILE" NEXT_PUBLIC_CCTP_INTAKE_CONTRACT "$INTAKE_ID"
CCTP_SESSION_KEY="$(read_env_value "$PENDING_ENV_FILE" CCTP_SESSION_KEY)"
if ! printf '%s' "$CCTP_SESSION_KEY" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  CCTP_SESSION_KEY="$(generate_session_key)"
  log "Generated a fresh CCTP session key; existing sealed sessions (if any) are unreadable with it"
fi
upsert_env_file "$PENDING_ENV_FILE" CCTP_SESSION_KEY "$CCTP_SESSION_KEY"
upsert_env_file "$PENDING_ENV_FILE" CCTP_ROUTE_MANIFEST "'$(route_manifest "$(read_env_value "$PENDING_ENV_FILE" CCTP_ROUTE_MANIFEST)" "$POOL_ID" "$INTAKE_ID")'"
upsert_env_file "$PENDING_ENV_FILE" CCTP_WORKER_ENABLED true
mv "$PENDING_ENV_FILE" "$ENV_FILE"
chmod 600 "$ENV_FILE"
STATUS="activated"; write_manifest

log "Deployment verified and configuration activated"
printf '  registry: %s\n  pool: %s\n  usdc SAC: %s\n  intake: %s\n  operator: %s\n  manifest: %s\n' \
  "$REGISTRY_ID" "$POOL_ID" "$USDC_SAC" "$INTAKE_ID" "$OPERATOR_ADDR" "$MANIFEST_FILE"
