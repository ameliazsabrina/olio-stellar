"use client";

import { AnchorProvider, BN, Program, type Wallet } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  type Transaction,
} from "@solana/web3.js";
import { bytesToHex, hexToBytes, parseUnits } from "viem";
import {
  CCTP_STELLAR_DOMAIN,
  cctpBinding,
  SOLANA_SRC_DOMAIN,
  solanaSource,
} from "../../lib/cctp";
import { fromBaseUnits } from "../../lib/crypto";
import type { FeeQuoteEnvelope } from "../../lib/fee-quote";
import { stellarContractToBytes32 } from "./burn";
import type { TokenMessengerMinterV2 } from "./idl/token_messenger_minter_v2";
import TOKEN_MESSENGER_MINTER_V2_IDL from "./idl/token_messenger_minter_v2.json";

// Solana CCTP V2 burn mirroring the EVM burnToStellar in ./burn.ts: same return contract, identical relayed message.
const SOLANA_USDC_DECIMALS = 6;
// Standard finalized transfer, no fast-transfer fee (matches the EVM path).
const MAX_FEE = new BN(0);
const MIN_FINALITY_THRESHOLD = 2000;

const TMM_PROGRAM_ID = new PublicKey(solanaSource.tokenMessengerMinter);
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  solanaSource.messageTransmitter,
);

// Structural wallet-adapter surface (owner pubkey + single-tx signer) to avoid React-context coupling.
export type SolanaBurnWallet = {
  publicKey: PublicKey | null;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
};

const enc = new TextEncoder();

// PDA derivation per solana-cctp-contracts utilsV2.ts: string seeds are UTF-8, remote domain is ASCII decimal (e.g. "27").
function findPda(
  seeds: (string | PublicKey)[],
  programId: PublicKey,
): PublicKey {
  const parts = seeds.map((s) =>
    typeof s === "string" ? enc.encode(s) : s.toBytes(),
  );
  return PublicKey.findProgramAddressSync(parts, programId)[0];
}

export type SolanaBurnResult = {
  txHash: string; // Solana transaction signature (base58)
  sourceDomain: typeof SOLANA_SRC_DOMAIN;
};

// Burn USDC on Solana to the Stellar intake contract, bound by the signed payment digest in hook data.
// An ephemeral messageSentEventData account co-signs, so we partial-sign then hand off to the wallet adapter.
export async function burnFromSolana(params: {
  intakeContract: string;
  feeQuote: FeeQuoteEnvelope;
  wallet: SolanaBurnWallet;
  connection: Connection;
  beforeBurn?: () => Promise<void>;
  onSubmitted?: (signature: string, validity: { blockhash: string; lastValidBlockHeight: number }) => Promise<void>;
}): Promise<SolanaBurnResult> {
  if (
    params.feeQuote.quote.expiresAt <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new Error("The fee quote expired before the CCTP burn.");
  }
  const { wallet, connection } = params;
  const owner = wallet.publicKey;
  const signTransaction = wallet.signTransaction;
  if (!owner || !signTransaction) {
    throw new Error("Connect a Solana wallet (Phantom, Solflare…) to pay.");
  }
  if (
    params.feeQuote.quote.sourceDomain !== SOLANA_SRC_DOMAIN ||
    bytesToHex(params.feeQuote.quote.sourcePayer).toLowerCase() !==
      bytesToHex(owner.toBytes()).toLowerCase()
  ) {
    throw new Error(
      "Connected Solana wallet does not match the signed fee quote.",
    );
  }

  const usdcMint = new PublicKey(solanaSource.usdcMint);
  const amountUnits = new BN(
    parseUnits(
      fromBaseUnits(params.feeQuote.quote.totalAmount),
      SOLANA_USDC_DECIMALS,
    ).toString(),
  );

  // mintRecipient: the Stellar intake contract's raw 32-byte id (same encoding the EVM path uses in bytes32).
  const mintRecipient = new PublicKey(
    hexToBytes(stellarContractToBytes32(params.intakeContract)),
  );

  // Immutable signed payment binding shared with the Stellar relay.
  const hookData = Buffer.from(cctpBinding(params.feeQuote.quote));

  // Anchor client used only to build/serialize; signing and sending are manual so the event account can co-sign.
  const providerWallet = {
    publicKey: owner,
    signTransaction,
    signAllTransactions: async (txs: Transaction[]) =>
      Promise.all(txs.map((t) => signTransaction(t))),
  } as unknown as Wallet;
  const provider = new AnchorProvider(connection, providerWallet, {
    commitment: "confirmed",
  });
  const program = new Program<TokenMessengerMinterV2>(
    TOKEN_MESSENGER_MINTER_V2_IDL as unknown as TokenMessengerMinterV2,
    provider,
  );

  // All PDAs are deterministic from const/owner/mint seeds, so pass a strict account set (no RPC resolution).
  const burnTokenAccount = getAssociatedTokenAddressSync(usdcMint, owner);
  const messageSentEventKeypair = Keypair.generate();

  const accounts = {
    owner,
    eventRentPayer: owner,
    senderAuthorityPda: findPda(["sender_authority"], TMM_PROGRAM_ID),
    burnTokenAccount,
    denylistAccount: findPda(["denylist_account", owner], TMM_PROGRAM_ID),
    messageTransmitter: findPda(
      ["message_transmitter"],
      MESSAGE_TRANSMITTER_PROGRAM_ID,
    ),
    tokenMessenger: findPda(["token_messenger"], TMM_PROGRAM_ID),
    remoteTokenMessenger: findPda(
      ["remote_token_messenger", String(CCTP_STELLAR_DOMAIN)],
      TMM_PROGRAM_ID,
    ),
    tokenMinter: findPda(["token_minter"], TMM_PROGRAM_ID),
    localToken: findPda(["local_token", usdcMint], TMM_PROGRAM_ID),
    burnTokenMint: usdcMint,
    messageSentEventData: messageSentEventKeypair.publicKey,
    messageTransmitterProgram: MESSAGE_TRANSMITTER_PROGRAM_ID,
    tokenMessengerMinterProgram: TMM_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    eventAuthority: findPda(["__event_authority"], TMM_PROGRAM_ID),
    program: TMM_PROGRAM_ID,
  };

  const tx: Transaction = await program.methods
    .depositForBurnWithHook({
      amount: amountUnits,
      destinationDomain: CCTP_STELLAR_DOMAIN,
      mintRecipient,
      destinationCaller: PublicKey.default, // any caller may relay
      maxFee: MAX_FEE,
      minFinalityThreshold: MIN_FINALITY_THRESHOLD,
      hookData,
    })
    .accountsStrict(accounts)
    .transaction();

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.feePayer = owner;
  tx.recentBlockhash = blockhash;
  // The freshly created event account co-signs; the owner signs via the wallet.
  tx.partialSign(messageSentEventKeypair);
  await params.beforeBurn?.();
  const signed = await signTransaction(tx);
  if (!wallet.publicKey?.equals(owner) || params.feeQuote.quote.expiresAt <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("Wallet changed or the payment quote expired before submission.");
  if (!signed.signature || !signed.verifySignatures()) throw new Error("The wallet did not sign the payment transaction.");
  const signature = base58(signed.signature);
  // Persist the signed identifier before any HTTP broadcast; a lost response cannot lose the payment.
  await params.onSubmitted?.(signature, { blockhash, lastValidBlockHeight });

  if (await connection.getBlockHeight("confirmed") > lastValidBlockHeight) throw new Error("The signed transaction expired before broadcast. Resume tracking to reconcile it.");
  await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2 });
  // The durable worker observes finality. No WebSocket confirmation dependency.

  return {
    txHash: signature,
    sourceDomain: SOLANA_SRC_DOMAIN,
  };
}

// Encode the 64-byte Ed25519 signature without adding an SDK dependency.
export function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let output = "";
  while (value > 0n) { output = alphabet[Number(value % 58n)] + output; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; output = "1" + output; }
  return output;
}
