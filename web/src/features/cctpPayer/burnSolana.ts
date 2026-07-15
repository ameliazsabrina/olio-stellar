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
  nonce: `0x${string}`;
};

// Burn USDC on Solana to the Stellar intake contract (domain 27), bound to the payee via hookData keccak(notePubkey ‖ nonce).
// An ephemeral messageSentEventData account co-signs, so we partial-sign then hand off to the wallet adapter.
export async function burnFromSolana(params: {
  intakeContract: string;
  payeeNotePubkey: Uint8Array;
  amount: string;
  wallet: SolanaBurnWallet;
  connection: Connection;
}): Promise<SolanaBurnResult> {
  const { wallet, connection } = params;
  const owner = wallet.publicKey;
  const signTransaction = wallet.signTransaction;
  if (!owner || !signTransaction) {
    throw new Error("Connect a Solana wallet (Phantom, Solflare…) to pay.");
  }

  const usdcMint = new PublicKey(solanaSource.usdcMint);
  const amountUnits = new BN(
    parseUnits(params.amount, SOLANA_USDC_DECIMALS).toString(),
  );

  // mintRecipient: the Stellar intake contract's raw 32-byte id (same encoding the EVM path uses in bytes32).
  const mintRecipient = new PublicKey(
    hexToBytes(stellarContractToBytes32(params.intakeContract)),
  );

  // Payee binding: random salt, keccak(notePubkey ‖ nonce).
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const hookData = Buffer.from(cctpBinding(params.payeeNotePubkey, nonce));

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
  const signed = await signTransaction(tx);

  const signature = await connection.sendRawTransaction(signed.serialize());
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `Solana burn failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  return {
    txHash: signature,
    sourceDomain: SOLANA_SRC_DOMAIN,
    nonce: bytesToHex(nonce),
  };
}
