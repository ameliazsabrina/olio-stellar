"use client";

import { StrKey } from "@stellar/stellar-sdk";
import {
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  erc20Abi,
  parseUnits,
} from "viem";
import {
  CCTP_STELLAR_DOMAIN,
  type EvmSource,
  evmSourceByChainId,
} from "../../lib/cctp";

// USDC is 6 decimals on every EVM chain.
const EVM_USDC_DECIMALS = 6;

// CCTP V2 TokenMessenger.depositForBurn (standard, finalized transfer).
const tokenMessengerAbi = [
  {
    name: "depositForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export function getEvmProvider(): EIP1193Provider {
  const provider = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) {
    throw new Error(
      "No EVM wallet found. Install MetaMask to pay from an EVM chain.",
    );
  }
  return provider;
}

/// Stellar classic account (G…) → left-padded bytes32 for CCTP mintRecipient.
export function stellarAddressToBytes32(address: string): `0x${string}` {
  const raw = StrKey.decodeEd25519PublicKey(address); // 32 bytes
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
}

export type BurnResult = { txHash: `0x${string}`; sourceDomain: number };

/// Approve (if needed) and burn `amount` USDC on the connected EVM chain,
/// minting to `intake` on Stellar. Returns the burn tx hash + source domain.
export async function burnToStellar(params: {
  intakeAddress: string;
  amount: string;
}): Promise<BurnResult> {
  const provider = getEvmProvider();
  const [account] = (await provider.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];
  if (!account) throw new Error("No EVM account authorized.");

  const chainIdHex = (await provider.request({
    method: "eth_chainId",
  })) as string;
  const chainId = Number.parseInt(chainIdHex, 16);
  const source: EvmSource | undefined = evmSourceByChainId(chainId);
  if (!source) {
    throw new Error(
      "Switch your wallet to a CCTP testnet (Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or Avalanche Fuji).",
    );
  }

  const publicClient = createPublicClient({ transport: custom(provider) });
  const walletClient = createWalletClient({ transport: custom(provider) });

  const amountUnits = parseUnits(params.amount, EVM_USDC_DECIMALS);
  const mintRecipient = stellarAddressToBytes32(params.intakeAddress);

  const allowance = await publicClient.readContract({
    address: source.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, source.tokenMessenger],
  });
  if (allowance < amountUnits) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: null,
      address: source.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [source.tokenMessenger, amountUnits],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const txHash = await walletClient.writeContract({
    account,
    chain: null,
    address: source.tokenMessenger,
    abi: tokenMessengerAbi,
    functionName: "depositForBurn",
    args: [
      amountUnits,
      CCTP_STELLAR_DOMAIN,
      mintRecipient,
      source.usdc,
      ZERO_BYTES32,
      0n, // maxFee: standard finalized transfer, no fast-transfer fee
      2000, // minFinalityThreshold: wait for finality
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, sourceDomain: source.domain };
}
