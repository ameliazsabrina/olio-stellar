import "server-only";

import {
  Address,
  BASE_FEE,
  hash,
  Keypair,
  Networks,
  rpc,
  StrKey,
  type Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  Client as ContractClient,
  type Result,
} from "@stellar/stellar-sdk/contract";
import { Binary } from "mongodb";
import { env } from "../../../env";
import { getServerEnv } from "../../../env.server";
import { getUsers, type UserDoc } from "../../db/mongo";
import { getPrivyUser } from "../../lib/privy";
import { relayXdr } from "../channels/channels.service";
import {
  WalletConflictError,
  WalletDeploymentError,
  WalletEscrowClobberError,
  WalletMigrationError,
} from "./wallets.errors";
import type {
  EscrowOutput,
  PrivyWalletInput,
  SaveEscrowInput,
  WalletOutput,
} from "./wallets.schema";

const networkPassphrase =
  env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const rpcUrl =
  env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const server = new rpc.Server(rpcUrl, {
  allowHttp: rpcUrl.startsWith("http://"),
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ReadonlyOwnerClient = ContractClient & {
  owner: () => Promise<{ result: Result<Buffer | Uint8Array> }>;
};

export function unwrapContractOwner(
  result: Result<Buffer | Uint8Array>,
): Buffer {
  return Buffer.from(result.unwrap());
}

function binary(value: string): Binary {
  return new Binary(Buffer.from(value, "hex"));
}

function hex(value: Binary): string {
  return Buffer.from(value.buffer).toString("hex");
}

function output(doc: UserDoc): WalletOutput {
  return {
    contractId: doc._id,
    privyWalletId: doc.privyWalletId,
    privyWalletAddress: doc.privyWalletAddress,
  };
}

type PrivyLinkedAccount = {
  type?: string;
  id?: string | null;
  address?: string;
  chain_type?: string;
  delegated?: boolean;
  wallet_client?: string;
  wallet_client_type?: string;
  connector_type?: string;
};

async function verifiedPrivyWallets(
  privyUserId: string,
): Promise<PrivyWalletInput[]> {
  const user = await getPrivyUser(privyUserId);
  const wallets = new Map<string, PrivyWalletInput>();
  for (const account of user.linked_accounts) {
    const candidate = account as unknown as PrivyLinkedAccount;
    if (
      candidate.type !== "wallet" ||
      !candidate.id ||
      candidate.chain_type !== "stellar" ||
      candidate.delegated !== false ||
      candidate.wallet_client !== "privy" ||
      candidate.wallet_client_type !== "privy" ||
      candidate.connector_type !== "embedded" ||
      !candidate.address ||
      !StrKey.isValidEd25519PublicKey(candidate.address)
    ) {
      continue;
    }
    // Privy's current wallet handle wins when stale and current handles share
    // the same cryptographic Stellar address.
    if (!wallets.has(candidate.address)) {
      wallets.set(candidate.address, {
        privyWalletId: candidate.id,
        privyWalletAddress: candidate.address,
      });
    }
  }
  return [...wallets.values()];
}

export function accountSalt(privyUserId: string): Buffer {
  return hash(Buffer.from(`olio:account:v2:${privyUserId}`));
}

export function deriveAccountContractId(
  deployerAddress: string,
  salt: Buffer,
  passphrase = networkPassphrase,
): string {
  const contractIdPreimage =
    xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(deployerAddress).toScAddress(),
        salt,
      }),
    );
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(passphrase)),
      contractIdPreimage,
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

export async function assertPrivyWalletOwned(
  privyUserId: string,
  wallet: PrivyWalletInput,
): Promise<void> {
  const match = (await verifiedPrivyWallets(privyUserId)).some(
    (candidate) =>
      candidate.privyWalletId === wallet.privyWalletId &&
      candidate.privyWalletAddress === wallet.privyWalletAddress,
  );
  if (!match) {
    throw new WalletConflictError(
      "The submitted Stellar wallet is not a user-owned Privy wallet linked to this identity.",
    );
  }
}

export async function restoreWallet(
  privyUserId: string,
): Promise<WalletOutput | null> {
  const wallets = await verifiedPrivyWallets(privyUserId);
  if (wallets.length === 0) return null;

  const users = await getUsers();
  const current = await users.findOne({ privyUserId });
  let existing = current;
  if (!existing) {
    const matches = await users
      .find({
        privyWalletAddress: {
          $in: wallets.map((wallet) => wallet.privyWalletAddress),
        },
      })
      .limit(2)
      .toArray();
    if (matches.length > 1) {
      throw new WalletConflictError(
        "Multiple Olio accounts match wallets on this Privy identity.",
      );
    }
    existing = matches[0] ?? null;
  }
  if (!existing) return null;

  const wallet = wallets.find(
    (candidate) => candidate.privyWalletAddress === existing.privyWalletAddress,
  );
  if (!wallet) {
    throw new WalletConflictError(
      "The Stellar wallet controlling this Olio account is not linked to the signed-in Privy identity.",
    );
  }
  if (
    existing.privyUserId === privyUserId &&
    existing.privyWalletId === wallet.privyWalletId
  ) {
    return output(existing);
  }

  try {
    const restored = await users.findOneAndUpdate(
      {
        _id: existing._id,
        privyUserId: existing.privyUserId,
        privyWalletAddress: existing.privyWalletAddress,
      },
      {
        $set: {
          privyUserId,
          privyWalletId: wallet.privyWalletId,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!restored) throw new WalletConflictError();
    return output(restored);
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new WalletConflictError();
    throw error;
  }
}

async function readOwner(contractId: string): Promise<Buffer | null> {
  try {
    const client = (await ContractClient.from({
      contractId,
      rpcUrl,
      networkPassphrase,
    })) as ReadonlyOwnerClient;
    return unwrapContractOwner((await client.owner()).result);
  } catch {
    return null;
  }
}

async function assertExpectedOwner(
  contractId: string,
  expectedOwner: Buffer,
): Promise<boolean> {
  const owner = await readOwner(contractId);
  if (!owner) return false;
  if (!owner.equals(expectedOwner)) {
    throw new WalletConflictError(
      "The deterministic Olio account already exists with a different owner.",
    );
  }
  return true;
}

async function waitForDeployment(transactionHash: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await server.getTransaction(transactionHash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
      throw new WalletDeploymentError(
        `Olio account deployment failed: ${result.status}`,
      );
    }
    await sleep(1000);
  }
  throw new WalletDeploymentError(
    "Olio account deployment confirmation timed out.",
  );
}

export function prepareSorobanTransactionForRelay(
  transaction: Transaction,
  sorobanData: xdr.SorobanTransactionData,
  signer: Keypair,
  timeoutInSeconds = 30,
): Transaction {
  // stellar-sdk 14.x's AssembledTransaction.sign() clones the already
  // assembled fee as the base fee. TransactionBuilder then adds the Soroban
  // resource fee again, which Channels rejects. Rebuild from the simulated
  // footprint with only the classic inclusion fee so resourceFee is added
  // exactly once.
  const prepared = TransactionBuilder.cloneFrom(transaction, {
    fee: BASE_FEE,
    timebounds: undefined,
    sorobanData,
  })
    .setTimeout(timeoutInSeconds)
    .build();
  prepared.sign(signer);
  return prepared;
}

async function deployAccount(
  privyUserId: string,
  privyWalletAddress: string,
): Promise<string> {
  const {
    OLIO_WALLET_DEPLOYER_SECRET: deployerSecret,
    OLIO_ACCOUNT_WASM_HASH: wasmHash,
  } = getServerEnv();
  if (!deployerSecret || !wasmHash) {
    throw new WalletDeploymentError(
      "Wallet deployment is not configured. Set OLIO_WALLET_DEPLOYER_SECRET and OLIO_ACCOUNT_WASM_HASH.",
    );
  }

  let deployer: Keypair;
  try {
    deployer = Keypair.fromSecret(deployerSecret);
  } catch {
    throw new WalletDeploymentError(
      "OLIO_WALLET_DEPLOYER_SECRET is not a valid Stellar secret.",
    );
  }

  const owner = Buffer.from(StrKey.decodeEd25519PublicKey(privyWalletAddress));
  const salt = accountSalt(privyUserId);
  const contractId = deriveAccountContractId(deployer.publicKey(), salt);
  if (await assertExpectedOwner(contractId, owner)) return contractId;

  try {
    const deployment = await ContractClient.deploy(
      { owner },
      {
        rpcUrl,
        networkPassphrase,
        publicKey: deployer.publicKey(),
        wasmHash,
        format: "hex",
        salt,
        timeoutInSeconds: 30,
      },
    );
    if (deployment.result.options.contractId !== contractId) {
      throw new WalletDeploymentError("Derived Olio account address mismatch.");
    }
    if (!deployment.built) {
      throw new WalletDeploymentError(
        "Olio account deployment was not assembled.",
      );
    }
    const signed = prepareSorobanTransactionForRelay(
      deployment.built,
      deployment.simulationData.transactionData,
      deployer,
    );
    const relayed = await relayXdr(signed.toXDR());
    await waitForDeployment(relayed.hash);
    if (!(await assertExpectedOwner(contractId, owner))) {
      throw new WalletDeploymentError(
        "Deployed Olio account owner could not be verified.",
      );
    }
    return contractId;
  } catch (error) {
    if (
      error instanceof WalletDeploymentError ||
      error instanceof WalletConflictError
    ) {
      throw error;
    }
    if (await assertExpectedOwner(contractId, owner)) return contractId;
    throw new WalletDeploymentError(
      error instanceof Error
        ? error.message
        : "Olio account deployment failed.",
    );
  }
}

async function linkExistingWallet(
  privyUserId: string,
  wallet: PrivyWalletInput,
): Promise<WalletOutput | null> {
  const users = await getUsers();
  const linked = await users.findOne({
    $or: [
      { privyWalletId: wallet.privyWalletId },
      { privyWalletAddress: wallet.privyWalletAddress },
    ],
    privyUserId: { $ne: privyUserId },
  });
  if (!linked) return null;
  if (
    linked.privyWalletId !== wallet.privyWalletId ||
    linked.privyWalletAddress !== wallet.privyWalletAddress
  ) {
    throw new WalletConflictError();
  }

  try {
    const reassociated = await users.findOneAndUpdate(
      {
        _id: linked._id,
        privyUserId: linked.privyUserId,
        privyWalletId: wallet.privyWalletId,
        privyWalletAddress: wallet.privyWalletAddress,
      },
      { $set: { privyUserId, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!reassociated) throw new WalletConflictError();
    return output(reassociated);
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new WalletConflictError();
    throw error;
  }
}

export async function bootstrapWallet(
  privyUserId: string,
  wallet: PrivyWalletInput,
): Promise<WalletOutput> {
  // Preserve compatibility with clients that predate the explicit restore
  // call and make races between restore and bootstrap idempotent.
  const restored = await restoreWallet(privyUserId);
  if (restored) return restored;

  await assertPrivyWalletOwned(privyUserId, wallet);
  const users = await getUsers();
  const existing = await users.findOne({ privyUserId });
  if (existing) {
    if (
      existing.privyWalletId !== wallet.privyWalletId ||
      existing.privyWalletAddress !== wallet.privyWalletAddress
    ) {
      throw new WalletConflictError(
        "This Privy identity is already bound to a different wallet.",
      );
    }
    return output(existing);
  }

  // Privy can issue a replacement DID when identities are linked or merged.
  // Ownership was verified above, so preserve and reopen the Olio account
  // already controlled by this embedded wallet instead of rejecting sign-in.
  const linked = await linkExistingWallet(privyUserId, wallet);
  if (linked) return linked;

  const contractId = await deployAccount(
    privyUserId,
    wallet.privyWalletAddress,
  );
  const now = new Date();
  try {
    await users.updateOne(
      { _id: contractId, privyUserId },
      {
        $set: {
          privyWalletId: wallet.privyWalletId,
          privyWalletAddress: wallet.privyWalletAddress,
          updatedAt: now,
        },
        $setOnInsert: { privyUserId, createdAt: now },
      },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const raced = await users.findOne({ privyUserId });
      if (raced) return output(raced);
      throw new WalletConflictError();
    }
    throw error;
  }
  const created = await users.findOne({ privyUserId });
  if (!created)
    throw new WalletDeploymentError("Wallet mapping could not be persisted.");
  return output(created);
}

export async function currentWallet(
  privyUserId: string,
): Promise<WalletOutput | null> {
  const doc = await (await getUsers()).findOne({ privyUserId });
  return doc ? output(doc) : null;
}

export async function saveEscrow(
  privyUserId: string,
  input: SaveEscrowInput,
): Promise<void> {
  const users = await getUsers();
  const doc = await users.findOne({ privyUserId });
  if (!doc) {
    throw new WalletMigrationError(
      "No Olio wallet is linked to this Privy identity.",
    );
  }
  const result = await users.updateOne(
    { _id: doc._id, privyUserId },
    {
      $set: {
        encryptedMaster: binary(input.encryptedMasterHex),
        masterSalt: binary(input.masterSaltHex),
        kdfParams: input.kdfParams,
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount !== 1) throw new WalletEscrowClobberError();
}

export async function getEscrow(privyUserId: string): Promise<EscrowOutput> {
  const doc = await (await getUsers()).findOne({ privyUserId });
  if (!doc?.encryptedMaster || !doc.masterSalt || !doc.kdfParams) return null;
  return {
    encryptedMasterHex: hex(doc.encryptedMaster),
    masterSaltHex: hex(doc.masterSalt),
    kdfParams: doc.kdfParams,
  };
}
