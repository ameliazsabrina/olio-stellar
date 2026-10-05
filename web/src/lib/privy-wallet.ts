import type { User } from "@privy-io/react-auth";
import {
  Address,
  authorizeEntry,
  hash,
  Keypair,
  StrKey,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { api } from "../trpc/client";
import {
  networkPassphrase,
  poolId,
  registryId,
  type Signer,
  server,
  usdcSacId,
} from "./stellar";

type ExtendedWallet = {
  id?: string | null;
  address: string;
  chainType?: string;
  chain_type?: string;
  delegated?: boolean;
};

export type PrivyStellarWallet = {
  id: string;
  address: string;
};

function normalizedWallet(value: unknown): PrivyStellarWallet | null {
  const wallet = value as ExtendedWallet;
  if (
    (wallet.chainType ?? wallet.chain_type) !== "stellar" ||
    wallet.delegated ||
    !wallet.id
  )
    return null;
  if (!StrKey.isValidEd25519PublicKey(wallet.address)) return null;
  return { id: wallet.id, address: wallet.address };
}

export async function resolvePrivyStellarWallet(
  user: User,
  createWallet: (input: {
    chainType: "stellar";
  }) => Promise<{ wallet: unknown }>,
): Promise<PrivyStellarWallet> {
  for (const account of user.linkedAccounts) {
    if (account.type !== "wallet") continue;
    const wallet = normalizedWallet(account as unknown as ExtendedWallet);
    if (wallet) return wallet;
  }

  const created = normalizedWallet(
    (await createWallet({ chainType: "stellar" })).wallet,
  );
  if (!created) {
    throw new Error(
      "Privy did not return a user-owned Stellar embedded wallet.",
    );
  }
  return created;
}

type AllowedInvocation = {
  contractId: string;
  method: string;
  args: unknown[];
};

function invocationTree(
  invocation: xdr.SorobanAuthorizedInvocation,
): AllowedInvocation[] {
  const out: AllowedInvocation[] = [];
  const fn = invocation.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new Error(
      "Only Soroban contract-function authorization is supported.",
    );
  }
  const call = fn.contractFn();
  out.push({
    contractId: Address.fromScAddress(call.contractAddress()).toString(),
    method: call.functionName().toString(),
    args: call.args().map((arg) => scValToNative(arg)),
  });
  for (const child of invocation.subInvocations()) {
    out.push(...invocationTree(child));
  }
  return out;
}

function assertAuthorizedEntry(
  entry: xdr.SorobanAuthorizationEntry,
  olioAddress: string,
): void {
  const credentials = entry.credentials();
  if (credentials.switch().name !== "sorobanCredentialsAddress") {
    throw new Error(
      "Privy can only sign address-based Soroban authorization entries.",
    );
  }
  const authorizedAddress = Address.fromScAddress(
    credentials.address().address(),
  ).toString();
  if (authorizedAddress !== olioAddress) {
    throw new Error("Authorization entry is for a different Olio account.");
  }

  const methods = new Map<string, Set<string>>([
    [registryId, new Set(["register", "set_pubkey"])],
    [poolId, new Set(["deposit", "withdraw", "transfer"])],
    [usdcSacId, new Set(["transfer"])],
  ]);
  if ([registryId, poolId, usdcSacId].some((value) => !value)) {
    throw new Error("Olio contract allowlist is not fully configured.");
  }
  for (const call of invocationTree(entry.rootInvocation())) {
    if (!methods.get(call.contractId)?.has(call.method)) {
      throw new Error(
        `Refusing to sign non-allowlisted invocation ${call.contractId}:${call.method}.`,
      );
    }
  }
}

function hexBytes(value: string): Uint8Array {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{128}$/.test(clean)) {
    throw new Error("Privy returned an invalid Ed25519 signature.");
  }
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

type PrivyRawHashSigner = (input: {
  address: string;
  chainType: "stellar";
  hash: `0x${string}`;
}) => Promise<{ signature: `0x${string}` }>;

const AUTH_VALID_LEDGERS = 60;

export function privySigner(options: {
  olioAddress: string;
  wallet: PrivyStellarWallet;
  signRawHash: PrivyRawHashSigner;
}): Signer {
  const { olioAddress, wallet, signRawHash } = options;
  return {
    address: olioAddress,
    signAuthEntries: async (entries) => {
      const { sequence } = await server.getLatestLedger();
      const validUntil = sequence + AUTH_VALID_LEDGERS;
      const out: string[] = [];
      for (const entry of entries) {
        assertAuthorizedEntry(entry, olioAddress);
        const signed = await authorizeEntry(
          entry,
          async (preimage) => {
            const digest = hash(preimage.toXDR());
            const { signature } = await signRawHash({
              address: wallet.address,
              chainType: "stellar",
              hash: `0x${Buffer.from(digest).toString("hex")}`,
            });
            const bytes = hexBytes(signature);
            if (
              !Keypair.fromPublicKey(wallet.address).verify(
                digest,
                bytes as unknown as Buffer,
              )
            ) {
              throw new Error(
                "Privy signature did not match the embedded wallet.",
              );
            }
            return { publicKey: wallet.address, signature: bytes };
          },
          validUntil,
          networkPassphrase,
        );
        out.push(signed.toXDR("base64"));
      }
      return out;
    },
    relaySoroban: async (func, auth) => {
      const result = await api.channels.relaySoroban.mutate({ func, auth });
      return { hash: result.hash };
    },
  };
}
