"use client";

import { StrKey } from "@stellar/stellar-sdk";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  erc20Abi,
  parseUnits,
} from "viem";
import {
  CCTP_STELLAR_DOMAIN,
  cctpBinding,
  type EvmSource,
  evmSourceByChainId,
} from "../../lib/cctp";

// USDC is 6 decimals on every EVM chain.
const EVM_USDC_DECIMALS = 6;

// CCTP V2 TokenMessenger.depositForBurnWithHook (standard, finalized transfer).
// The trailing hookData carries our payee-binding commitment; it rides along in
// the attested message so the relay can verify who the burn was meant for.
const tokenMessengerAbi = [
  {
    name: "depositForBurnWithHook",
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
      { name: "hookData", type: "bytes" },
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

/// Stellar contract (C…) → 32-byte CCTP mintRecipient. Circle's Stellar minter
/// interprets the mintRecipient bytes unconditionally as a contract-id hash
/// (`AddressPayload::ContractIdHash`), so the intake **must** be a contract and
/// we encode the raw 32-byte contract id here.
export function stellarContractToBytes32(contractId: string): `0x${string}` {
  const raw = StrKey.decodeContract(contractId); // 32 bytes
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
}

export type BurnResult = {
  txHash: `0x${string}`;
  sourceDomain: number;
  nonce: `0x${string}`;
};

/// Approve (if needed) and burn `amount` USDC on the connected EVM chain,
/// minting to the intake **contract** on Stellar. The burn is bound to the payee
/// via a salted commitment in hookData (keccak256(payeeNotePubkey ‖ nonce)); the
/// random nonce is returned so the relay can recompute and verify the binding.
/// Returns the burn tx hash, source domain, and nonce.
export async function burnToStellar(params: {
  intakeContract: string;
  payeeNotePubkey: Uint8Array;
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
  const mintRecipient = stellarContractToBytes32(params.intakeContract);

  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const hookData = bytesToHex(cctpBinding(params.payeeNotePubkey, nonce));

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
    functionName: "depositForBurnWithHook",
    args: [
      amountUnits,
      CCTP_STELLAR_DOMAIN,
      mintRecipient,
      source.usdc,
      ZERO_BYTES32,
      0n, // maxFee: standard finalized transfer, no fast-transfer fee
      2000, // minFinalityThreshold: wait for finality
      hookData,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, sourceDomain: source.domain, nonce: bytesToHex(nonce) };
}
