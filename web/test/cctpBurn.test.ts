// @vitest-environment node
import { StrKey } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  request: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mocks.readContract,
      waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    }),
    createWalletClient: () => ({ writeContract: mocks.writeContract }),
    custom: (provider: unknown) => provider,
  };
});

import {
  burnToStellar,
  ensureEvmChain,
  evmCctpIdentity,
  stellarContractToBytes32,
} from "../src/features/cctpPayer/burn";
import { cctpBinding, EVM_SOURCES } from "../src/lib/cctp";
import type { FeeQuoteEnvelope } from "../src/lib/fee-quote";

const account = "0x1111111111111111111111111111111111111111" as const;
const intake = StrKey.encodeContract(Buffer.alloc(32, 8));
const feeQuote: FeeQuoteEnvelope = {
  quote: {
    formatVersion: 1,
    policyVersion: 2,
    quoteId: new Uint8Array(32).fill(1),
    networkId: new Uint8Array(32).fill(2),
    pool: StrKey.encodeContract(Buffer.alloc(32, 9)),
    depositor: intake,
    commitment: new Uint8Array(32).fill(3),
    paymentAmount: 1_000_000_000n,
    feeBps: 200,
    feeAmount: 20_000_000n,
    totalAmount: 1_020_000_000n,
    channel: "cctp",
    sourceDomain: 0,
    sourcePayer: new Uint8Array([
      ...new Uint8Array(12),
      ...Buffer.from(account.slice(2), "hex"),
    ]),
    issuedAt: 1n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 900),
  },
  signature: new Uint8Array(64),
};

describe("EVM CCTP gross burn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "ethereum", {
      configurable: true,
      value: { request: mocks.request },
    });
    mocks.request.mockImplementation(({ method }: { method: string }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return Promise.resolve([account]);
      if (method === "eth_chainId") return Promise.resolve("0xaa36a7");
      throw new Error(`unexpected method ${method}`);
    });
    mocks.readContract.mockResolvedValue(102_000_000n);
    mocks.writeContract.mockResolvedValue(`0x${"ab".repeat(32)}`);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("burns the signed gross and carries the immutable binding", async () => {
    const result = await burnToStellar({
      intakeContract: intake,
      feeQuote,
    });
    expect(result).toMatchObject({ sourceDomain: 0 });
    expect(mocks.writeContract).toHaveBeenCalledOnce();
    expect(mocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "depositForBurnWithHook",
        args: [
          102_000_000n,
          27,
          stellarContractToBytes32(intake),
          expect.any(String),
          `0x${"00".repeat(32)}`,
          0n,
          2000,
          `0x${Buffer.from(cctpBinding(feeQuote.quote)).toString("hex")}`,
        ],
      }),
    );
  });

  it("blocks an expired quote before opening the wallet", async () => {
    await expect(
      burnToStellar({
        intakeContract: intake,
        feeQuote: {
          ...feeQuote,
          quote: { ...feeQuote.quote, expiresAt: 1n },
        },
      }),
    ).rejects.toThrow("expired before the CCTP burn");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });
  const baseQuote = {
    ...feeQuote,
    quote: { ...feeQuote.quote, sourceDomain: 6 },
  };
  function switchingWallet(
    switchError?: unknown,
    addError?: unknown,
    stays = false,
  ) {
    let chainId = "0xaa36a7";
    mocks.request.mockImplementation(async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [account];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        if (switchError) throw switchError;
        if (!stays) chainId = "0x14a34";
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        if (addError) throw addError;
        if (!stays) chainId = "0x14a34";
        return null;
      }
      throw new Error(`unexpected method ${method}`);
    });
  }

  it("connects before switching to the quoted Base network and burning", async () => {
    switchingWallet();
    await expect(
      burnToStellar({ intakeContract: intake, feeQuote: baseQuote }),
    ).resolves.toMatchObject({ sourceDomain: 6 });
    expect(mocks.request.mock.calls[0][0].method).toBe("eth_requestAccounts");
    expect(mocks.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x14a34" }],
    });
  });

  it.each([
    { code: 4902 },
    { code: -32603, data: { originalError: { code: "4902" } } },
  ])("adds an unknown Base network: %j", async (error) => {
    switchingWallet(error);
    await burnToStellar({ intakeContract: intake, feeQuote: baseQuote });
    expect(mocks.request).toHaveBeenCalledWith({
      method: "wallet_addEthereumChain",
      params: [
        expect.objectContaining({
          chainId: "0x14a34",
          chainName: "Base Sepolia",
          rpcUrls: ["https://sepolia.base.org"],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        }),
      ],
    });
  });

  it("stops before writing when switching is rejected", async () => {
    switchingWallet({ code: 4001 });
    await expect(
      burnToStellar({ intakeContract: intake, feeQuote: baseQuote }),
    ).rejects.toThrow(/Switch your wallet to Base Sepolia/);
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("explains a rejected add request", async () => {
    switchingWallet({ code: 4902 }, { code: 4001 });
    await expect(ensureEvmChain(EVM_SOURCES[6])).rejects.toThrow(
      /Add Base Sepolia/,
    );
  });

  it("does not trust add success when the wallet stays on another network", async () => {
    switchingWallet({ code: 4902 }, undefined, true);
    await expect(
      burnToStellar({ intakeContract: intake, feeQuote: baseQuote }),
    ).rejects.toThrow(/still on another network/);
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("pins the identity used for issuing a Base quote", async () => {
    switchingWallet();
    await expect(evmCctpIdentity(6)).resolves.toEqual({
      sourceDomain: 6,
      sourcePayer: "0".repeat(24) + "11".repeat(20),
    });
    expect(mocks.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x14a34" }],
    });
  });
});
