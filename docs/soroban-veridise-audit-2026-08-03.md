# Soroban contract audit against the Veridise checklist

**Date:** 2026-08-03  
**Scope:** `programs/olio-pool`, `programs/olio-intake`, `programs/olio-registry`  
**Verdict:** **Block mainnet deployment**  
**Review type:** Read-only static review plus local build and tests; no live-network testing and no code changes.

The primary standard was Veridise's Soroban checklist: collection-input validation, fuzzable error handling, explicit/reproducible contract dependencies, bounded storage, and documented trust assumptions. The pool's circuits were read only where needed to verify contract-level security claims.

This is a pre-audit review, not a substitute for an independent contract and circuit audit.

## Executive summary

The storage design is mostly disciplined: growing nullifiers use separate persistent entries, while instance vectors for the Merkle tree and root history are bounded. No embedded WASM or `contractimport!` dependency exists in `programs/`.

However, the pool has one critical accounting flaw: a deposit's transferred token amount is not cryptographically or programmatically bound to the amount encoded in its note commitment. An attacker can deposit a small value, commit to a much larger value, and later produce a valid withdrawal proof for the larger amount. This can drain other users' liquidity.

The audit also found an unrestricted governance trust boundary, an unvalidated `Vec` inside stored verification keys, an implicit intake-to-pool ABI dependency, and several normal-input paths that can trap instead of returning typed errors.

## Findings

| ID | Severity | Area | Finding |
|---|---|---|---|
| C-01 | Critical | Pool accounting | Deposited tokens are not bound to the value encoded in the note commitment |
| H-01 | High — remediated and rehearsed on Testnet | Trust assumptions | Sensitive governance requires native 2-of-3 authorization and an immutable 48-hour timelock; immediate emergency powers remain disclosed |
| M-01 | Medium — remediated locally | Collection input | Constructor and governance proposals validate exact verifier-key IC lengths before storage |
| M-02 | Medium | Dependencies | Intake depends on the pool ABI through raw `Val` invocation, but the dependency is not explicit or tested against the real pool |
| L-01 | Low | Error handling/fuzzing | Malformed proofs, recipient strings, and storage invariant failures can produce host/bare panics |
| L-02 | Low | Bounded input | Deposit and transfer accept unbounded ciphertext bytes and publish them in events |
| L-03 | Low | Deployment invariant | Pool depth is configurable up to 32 while both production circuits are fixed at depth 20 |
| L-04 | Low | Registry validation | Username character/canonicalization rules exist only in the frontend, not in the on-chain namespace |
| I-01 | Informational | Archival | Persistent registry records and spent-nullifier entries have no ongoing TTL policy or archival tests |

## C-01 — Deposited value is not bound to the note commitment

**Evidence:**

- `programs/olio-pool/src/lib.rs:187-208`
- `circuits/src/withdraw.circom:67-80`
- `circuits/src/withdraw.circom:94-96`

`deposit` accepts `commitment` and `amount` as independent caller-controlled arguments. It transfers `amount`, then inserts `commitment` without proving or recomputing that the commitment contains the same amount:

```rust
token::Client::new(&env, &config.asset).transfer(
    &from,
    &env.current_contract_address(),
    &amount,
);

let leaf = to_u256(&env, &commitment);
let leaf_index = insert(&env, &config, &leaf)?;
```

The withdrawal circuit reconstructs the note as `Poseidon(amount, ownerPk, salt)` and proves its Merkle membership. Therefore the proof correctly authorizes the amount encoded inside the commitment, but the contract never establishes that this was the amount deposited.

An attack is:

1. Construct a note commitment containing a large amount controlled by the attacker.
2. Call `deposit` with that commitment but transfer only one token unit.
3. Generate a valid membership and withdrawal proof for the large committed amount.
4. Withdraw pooled tokens belonging to other depositors.

The circuit's 64-bit amount constraint bounds the forged value but does not prevent the attack.

**Recommendation:** Block deployment until deposits bind value on-chain. Prefer a deposit proof whose public inputs include both `commitment` and `amount`. Alternatives are fixed-denomination pools or on-chain commitment construction, provided the resulting privacy tradeoff is explicitly accepted. Add an adversarial regression test that deposits amount `x` with a commitment for `y != x` and proves that withdrawal of `y` cannot succeed.

## H-01 — Governance has immediate control over pooled funds

**Remediation update (2026-08-10): Remediated and fully rehearsed on Testnet.** The new ABI removes immediate upgrades, verifier-key setters, and legacy admin acceptance. Upgrades, all three verifier-key replacements, and admin rotation share one pending slot and an immutable 172,800-second ledger-timestamp delay. Proposed actions are deterministically serialized and hashed for event and artifact comparison. Anyone may execute a mature verifier/WASM action; rotation also requires the proposed new admin's authorization. Fresh deployments receive all three validated verifier keys atomically. Operations require a native 2-of-3 G-account and disclose that two custodians retain immediate pause/unpause and cancellation power.

Unit tests cover current-admin proposal/cancellation authorization, proposal serialization, one-pending-action enforcement, exact timing, ID mismatch, cancellation/replay, permissionless execution, new-admin co-authorization, verifier validation, TTL extension, and state preservation across actual WASM activation. On Testnet, the exact reviewed WASM `f84fc186...4588d` was uploaded and activated on the existing pool; all checked state survived and the live bytes matched. Proposal ID 1 demonstrated the payload hash and exact deadline before successful cancellation. The existing admin `GDAFLEJV...26IKQ` was retained and atomically configured with three weight-1 signers and low/medium/high thresholds 1/2/2. A single-signature proposal was rejected, while same-WASM proposal ID 2 succeeded with two configured signers. After the full deadline, the non-admin CCTP operator executed it permissionlessly in transaction `eebd17668a91a152d993e9ee0799420be4495109a40cf20512295f3448186c2f`; the pending slot cleared and the live WASM, admin, configuration, pause state, verifier-key flags, root, leaf count, and token balance were preserved. Transaction evidence is recorded in `docs/mainnet-operations.md`.

**Original evidence and finding:**

**Evidence:**

- `programs/olio-pool/src/lib.rs:164-181`
- `programs/olio-pool/src/lib.rs:430-462`
- `docs/security.md:8-12`
- `docs/mainnet-operations.md:9-18`

The admin can immediately replace both Groth16 verification keys and activate arbitrary uploaded WASM. A malicious or compromised admin can install a verifier for a trivial circuit or upgrade to code that transfers all pool assets. The admin can also pause every value path.

The mainnet runbook plans a 2-of-3 Stellar multisig, which reduces single-key compromise risk, but this is an operational policy rather than a contract-enforced delay. Two signers still have immediate, unrestricted control. This conflicts with public-facing statements that the operator cannot spend or freeze user money.

**Recommendation:** Precisely disclose the governance power. Require a production multisig, and add a timelocked propose/execute flow for verifier-key changes and upgrades, with an emergency policy whose powers are narrower and explicitly documented. Verifier-key hashes and approved WASM hashes should be independently reproducible and recorded before execution.

## M-01 — Verification-key vector is stored without eager validation

**Remediation update (2026-08-06): Remediated locally.** Fresh deployment validates and atomically stores deposit, withdrawal, and transfer keys with exact IC lengths 3, 5, and 5. Timelocked verifier proposals apply the same validation before writing pending state and eagerly traverse every IC entry. Invalid-key constructor and proposal tests cover all three verifier kinds.

**Original evidence and finding:**

**Evidence:**

- `programs/olio-pool/src/groth16.rs:17-26`
- `programs/olio-pool/src/lib.rs:164-181`
- `programs/olio-pool/src/groth16.rs:46-60`

Both key-setting functions accept and immediately store `VerificationKey`, whose `ic` field is a Soroban `Vec<BytesN<64>>`. Soroban collection conversion does not guarantee eager conversion of every nested element. The setters do not iterate through the vector, enforce the required length, or otherwise validate it before it becomes instance state.

Both current circuits expose four public signals, so a valid key must have exactly five IC points. An incorrectly sized key makes every proof return false; a malformed nested value or invalid curve point can later trap during verification. An oversized key also unnecessarily enlarges the contract instance entry and increases the bytes loaded by every interaction.

Only the admin can trigger this, so it is primarily an operational-bricking and deployment-safety risk rather than an unprivileged attack.

**Recommendation:** Before storage, require exactly five IC entries and force conversion/validation of every entry. Prefer a fixed-shape representation where practical. Validate the full verification key during deployment against a known proof and pin its canonical hash in CI and the operations runbook.

## M-02 — Intake-to-pool dependency is implicit and can drift

**Evidence:**

- `programs/olio-intake/Cargo.toml:1-14`
- `programs/olio-intake/src/lib.rs:79-105`
- `programs/olio-intake/src/test.rs:10-36`

The intake constructs `Vec<Val>` arguments and invokes the symbol `deposit` dynamically. It has no explicit dependency on a pool interface or generated contract client. Its tests use a local mock that duplicates the expected signature rather than invoking the real pool contract.

If the pool's argument order, types, return type, authorization tree, or function name changes, the intake can still compile and its mock-based tests can still pass. The deployed call will then trap or fail authorization.

This is not the exact stale-embedded-WASM problem described by Veridise, but it has the same root cause: the build graph does not represent the real contract dependency.

**Recommendation:** Define a shared, versioned pool interface or generate a client from a pinned contract spec/WASM. Add an integration test that registers the real `PoolContract`, not only `MockPool`, and executes the intake flow. Record compatible pool/intake hashes as one deployment unit.

## L-01 — Expected invalid inputs can trap

**Evidence:**

- `programs/olio-pool/src/groth16.rs:56-77`
- `programs/olio-pool/src/lib.rs:270`
- `programs/olio-pool/src/lib.rs:383-386`
- `programs/olio-pool/src/lib.rs:587-624`

Malformed G1/G2 point encodings reach BN254 host functions that validate the points and can trap. `Address::from_string` explicitly panics for malformed or unsupported strkeys. Several storage and vector operations use `.unwrap()` for assumed invariants.

These failures roll back atomically and do not let an attacker corrupt state, but they violate the Veridise fuzzability guidance: bad user input should produce a recognizable contract error, while a bare panic should identify an actual bug.

**Recommendation:** Add fuzz/property tests over proof bytes, recipient strings, commitments, roots, and nullifiers. Invalid proof material should consistently return `InvalidProof`; invalid destinations should return a dedicated error. Replace invariant unwraps with typed errors or `panic_with_error!` and document which failures indicate corrupted state.

## L-02 — Ciphertext input is not bounded

**Evidence:**

- `programs/olio-pool/src/lib.rs:187-216`
- `programs/olio-pool/src/lib.rs:298-372`
- `programs/olio-intake/src/lib.rs:58-105`

`ciphertext`, `recipient_ciphertext`, and `change_ciphertext` are arbitrary `Bytes`. They are not stored in contract storage, which avoids permanent state growth, but they are included in contract calls and published events. Network transaction/resource limits provide an outer ceiling; the contract does not enforce the protocol's expected encrypted-note shape.

**Recommendation:** Define and enforce a maximum or exact ciphertext length derived from the encryption format. Apply the same validation in the intake before its nested call.

## L-03 — Circuit depth and contract depth can diverge

**Evidence:**

- `programs/olio-pool/src/lib.rs:37-41`
- `programs/olio-pool/src/lib.rs:134-160`
- `circuits/src/withdraw.circom:103`
- `circuits/src/transfer.circom:132`
- `scripts/deploy-testnet.sh:13`

The contract accepts any depth from 1 through 32. Both circuits are compiled with depth 20. Deploying another valid contract depth creates a pool for which the supplied circuits cannot generate valid membership proofs.

**Recommendation:** Enforce depth 20 for these artifacts, or version and deploy circuit/verifier artifacts per supported depth. CI should assert the constructor depth, circuit depth, verifier keys, and client configuration as one invariant.

## L-04 — Registry rules are not enforced on-chain

**Evidence:**

- `programs/olio-registry/src/lib.rs:10-12`
- `programs/olio-registry/src/lib.rs:136-145`

The contract enforces only a byte-length range. Any user can bypass the frontend and register mixed-case, Unicode lookalike, control-like, or otherwise unsupported names. Exact-key uniqueness prevents direct duplication, but display ambiguity and inconsistent client normalization can create phishing and lookup problems in a payment namespace.

**Recommendation:** Make the contract the source of truth for an explicit canonical username grammar, such as normalized lowercase ASCII with a small allowed character set. Test boundary lengths and confusable/unsupported inputs.

## I-01 — Archival behavior needs explicit operations and tests

Registry records are separate persistent entries but never have their TTL extended. Spent nullifiers are persistent and extended once to 90 days. Under current Soroban archival semantics, an archived persistent entry must be restored before contract logic can access it and cannot be silently recreated, so this review did **not** identify a demonstrated double-spend path from TTL expiry.

There is still an availability and fee concern: old usernames and reused nullifier keys may require restoration, and the repository contains no archival tests or maintenance policy.

**Recommendation:** Test expired registry and nullifier entries under the target protocol, document who pays restoration fees, and provide an operational restoration path. Treat nullifier restoration behavior as a security invariant.

## Checklist results

### Collection inputs

- **Remediated locally:** verifier-key IC lengths are bounded by kind and entries are eagerly traversed before constructor or proposal storage.
- No public `Map` inputs were found.
- Internal Merkle vectors are bounded by `depth <= 32`; root history is bounded to 30.

### Fuzzable error handling

- **Partial:** Most entrypoints return typed `Result` errors and constructor depth uses `panic_with_error!`.
- **Needs remediation:** Invalid cryptographic encodings, malformed recipient strings, and invariant unwraps can trap.
- No fuzz harness or property suite was found.

### Dependencies

- **Pass:** No `contractimport!`, `contractfile!`, embedded dependent WASM, or stale binary import exists in `programs/`.
- **Partial:** Rust dependencies are recorded in `Cargo.lock`; `soroban-poseidon` resolves to a specific Git commit.
- **Needs remediation:** The intake's real dependency on the pool ABI is absent from its build/test graph.

### Storage growth

- **Pass:** Nullifiers use one persistent slot per nullifier rather than one growing collection.
- **Pass:** Registry accounts use separate persistent keys.
- **Pass:** Merkle `Zeros`/`Filled` and `Roots` instance vectors have strict bounds.
- **Remediated locally:** verification-key vector size is bounded before constructor and proposal storage.
- Ciphertext is event data, not stored state, but should still be bounded at the interface.

### Trust assumptions

- **Remediated and rehearsed on Testnet:** proof-rule replacement, WASM activation, and governance rotation require an immutable 48-hour delay under the native 2-of-3 admin.
- Two custodians retain the disclosed ability to pause/unpause immediately and cancel proposals.
- The intake admin can decide which notes receive bridged funds and can strand its balance by supplying unusable note data.

## Positive controls observed

- Constructor-based initialization prevents public reinitialization.
- Authorization is present on deposits, intake forwarding, and all pool governance operations.
- Admin transfer uses a timelocked proposal plus proposed-new-admin authorization at execution.
- Withdrawal and transfer write the nullifier before external token transfer or leaf insertion; Soroban atomic rollback preserves consistency on later failure.
- Root history and tree helper vectors are explicitly bounded.
- Nullifiers and registry records are sharded across persistent storage keys.
- Withdrawal public signals bind the root, nullifier, destination field, and amount.
- Transfer circuits enforce input ownership, nullifier derivation, output commitments, 64-bit amount ranges, and value conservation.

## Verification performed

- `cargo test --workspace` — **passed:** 27 tests.
- `cargo build --workspace --release --target wasm32v1-none --locked` — **passed** with six deprecation warnings for `Events::publish`.
- `cargo clippy --workspace --all-targets -- -D warnings` — **failed** on the same deprecated event API plus test-only style/dead-code warnings and two needless-borrow warnings.

No code, configuration, contract state, or network deployment was modified as part of this audit.

## Recommended remediation order

1. Fix C-01 and add an adversarial inflation regression test.
2. Preserve the H-01 reviewed-hash, monitoring, rollback, and user-notification procedure for every governance action.
3. Add real pool/intake integration coverage.
4. Add fuzz/property coverage for every public pool entrypoint and cryptographic input.
5. Bound ciphertexts and enforce the on-chain username grammar.
6. Lock circuit depth/artifact hashes into CI and deployment operations.
7. Add TTL archival/restoration tests and an operating procedure.
