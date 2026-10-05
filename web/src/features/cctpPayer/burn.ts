"use client";

import { StrKey } from "@stellar/stellar-sdk";
import {
  type AddEthereumChainParameter,
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  erc20Abi,
  http,
  parseUnits,
} from "viem";
import {
  CCTP_STELLAR_DOMAIN,
  cctpBinding,
  cctpRpcPath,
  EVM_SOURCES,
  type EvmSource,
  evmSourceByChainId,
} from "../../lib/cctp";
import { fromBaseUnits } from "../../lib/crypto";
import type { FeeQuoteEnvelope } from "../../lib/fee-quote";

const EVM_USDC_DECIMALS = 6;

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

export const evmChainIdHex = (source: EvmSource): `0x${string}` =>
  `0x${source.chainId.toString(16)}`;
export const evmChainParams = (
  source: EvmSource,
): AddEthereumChainParameter => ({
  chainId: evmChainIdHex(source),
  chainName: source.name,
  nativeCurrency: source.nativeCurrency,
  rpcUrls: [source.rpcUrl],
  blockExplorerUrls: [new URL(source.explorerTx).origin],
});

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; data?: { originalError?: unknown } };
  // MetaMask can wrap the actionable wallet error in a generic JSON-RPC error.
  const nested = errorCode(value.data?.originalError);
  if (nested !== undefined) return nested;
  const code = Number(value.code);
  return value.code != null && Number.isFinite(code) ? code : undefined;
}
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | null)?.message ?? error);
const isUnrecognizedChain = (error: unknown) =>
  errorCode(error) === 4902 ||
  /unrecognized chain|wallet_addEthereumChain/i.test(errorMessage(error));
const isUserRejection = (error: unknown) =>
  errorCode(error) === 4001 ||
  /user rejected|user denied/i.test(errorMessage(error));

export async function ensureEvmChain(
  source: EvmSource,
  provider = getEvmProvider(),
) {
  if (
    Number(await provider.request({ method: "eth_chainId" })) === source.chainId
  )
    return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: evmChainIdHex(source) }],
    });
  } catch (error) {
    if (isUserRejection(error))
      throw new Error(`Switch your wallet to ${source.name} to continue.`);
    if (isUnrecognizedChain(error)) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [evmChainParams(source)],
        });
      } catch (addError) {
        if (isUserRejection(addError))
          throw new Error(`Add ${source.name} to your wallet to continue.`);
      }
    }
  }
  // Adding a chain need not select it. Trust the wallet's actual network, not RPC success.
  if (
    Number(await provider.request({ method: "eth_chainId" })) !== source.chainId
  ) {
    throw new Error(
      `Your wallet is still on another network. Switch it to ${source.name} and try again.`,
    );
  }
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
};

export async function detectEvmSourceDomain(): Promise<number | null> {
  const provider = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) return null;
  try {
    const chainIdHex = (await provider.request({
      method: "eth_chainId",
    })) as string;
    return evmSourceByChainId(Number.parseInt(chainIdHex, 16))?.domain ?? null;
  } catch {
    return null;
  }
}

export function onEvmChainChanged(
  listener: (chainIdHex: string) => void,
): () => void {
  const provider = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider?.on || !provider.removeListener) return () => {};
  provider.on("chainChanged", listener);
  return () => provider.removeListener?.("chainChanged", listener);
}

export function onEvmAccountsChanged(
  listener: (accounts: string[]) => void,
): () => void {
  const provider = (globalThis as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider?.on || !provider.removeListener) return () => {};
  provider.on("accountsChanged", listener);
  return () => provider.removeListener?.("accountsChanged", listener);
}

export async function evmCctpIdentity(expectedDomain?: number): Promise<{
  sourceDomain: number;
  sourcePayer: string;
}> {
  const expected =
    expectedDomain === undefined ? undefined : EVM_SOURCES[expectedDomain];
  const provider = getEvmProvider();
  const [account] = (await provider.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];
  if (!account) throw new Error("No EVM account authorized.");
  if (expected) await ensureEvmChain(expected, provider);
  const chainIdHex = (await provider.request({
    method: "eth_chainId",
  })) as string;
  const source = evmSourceByChainId(Number.parseInt(chainIdHex, 16));
  if (!source)
    throw new Error("Switch your wallet to a supported CCTP testnet.");
  if (expected && source.domain !== expected.domain)
    throw new Error(`Switch your wallet to ${expected.name} to continue.`);
  return {
    sourceDomain: source.domain,
    sourcePayer: account.slice(2).padStart(64, "0").toLowerCase(),
  };
}

export async function burnToStellar(params: {
  intakeContract: string;
  feeQuote: FeeQuoteEnvelope;
  beforeBurn?: () => Promise<void>;
  onSubmitted?: (txHash: string) => Promise<void>;
}): Promise<BurnResult> {
  if (
    params.feeQuote.quote.expiresAt <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    throw new Error("The fee quote expired before the CCTP burn.");
  }
  const provider = getEvmProvider();
  const [account] = (await provider.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];
  if (!account) throw new Error("No EVM account authorized.");

  // The signed quote, not the wallet's current network, determines where funds burn.
  const quotedSource = EVM_SOURCES[params.feeQuote.quote.sourceDomain];
  if (!quotedSource)
    throw new Error("Unsupported EVM source in the signed fee quote.");
  await ensureEvmChain(quotedSource, provider);

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
  const sourcePayer = account.slice(2).padStart(64, "0").toLowerCase();
  if (
    params.feeQuote.quote.sourceDomain !== source.domain ||
    bytesToHex(params.feeQuote.quote.sourcePayer).slice(2).toLowerCase() !==
      sourcePayer
  ) {
    throw new Error(
      "Connected EVM wallet does not match the signed fee quote.",
    );
  }

  const publicClient = createPublicClient({
    transport: http(cctpRpcPath(source.domain), { retryCount: 0 }),
  });
  const walletClient = createWalletClient({ transport: custom(provider) });

  const amountUnits = parseUnits(
    fromBaseUnits(params.feeQuote.quote.totalAmount),
    EVM_USDC_DECIMALS,
  );
  const mintRecipient = stellarContractToBytes32(params.intakeContract);

  const hookData = bytesToHex(cctpBinding(params.feeQuote.quote));

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
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
      timeout: 120_000,
    });
    if (receipt.status !== "success")
      throw new Error("USDC approval failed. No payment was submitted.");
  }

  await params.beforeBurn?.();
  const currentAccounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];
  const currentChain = await provider.request({ method: "eth_chainId" });
  if (
    currentAccounts[0]?.toLowerCase() !== account.toLowerCase() ||
    Number.parseInt(String(currentChain), 16) !== source.chainId
  )
    throw new Error(
      "Your wallet account or network changed. Review the payment again.",
    );
  if (params.feeQuote.quote.expiresAt <= BigInt(Math.floor(Date.now() / 1000)))
    throw new Error("The fee quote expired before the CCTP burn.");
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
  await params.onSubmitted?.(txHash);
  return { txHash, sourceDomain: source.domain };
}
