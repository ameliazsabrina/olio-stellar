import { describe, expect, it } from "vitest";
import { EVM_SOURCES } from "../src/lib/cctp";
import { validateRpcRequest } from "../src/server/modules/cctp/cctp.rpc";
const request = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });
describe("constrained source RPC", () => {
  it("allows only the USDC reads used by checkout", () => {
    expect(validateRpcRequest(0, request("eth_call", [{ to: EVM_SOURCES[0].usdc, data: `0xdd62ed3e${"00".repeat(64)}` }, "latest"])).method).toBe("eth_call");
    expect(() => validateRpcRequest(0, request("eth_call", [{ to: "0x123", data: "0xdeadbeef" }, "latest"]))).toThrow();
  });
  it.each(["eth_sendTransaction", "personal_sign", "eth_accounts", "wallet_addEthereumChain", "eth_getLogs", "debug_traceTransaction"])("rejects %s from browsers", method => {
    expect(() => validateRpcRequest(0, request(method))).toThrow();
  });
  it("rejects batches, arbitrary URLs, wrong-chain methods, oversized signature batches and skipPreflight", () => {
    expect(() => validateRpcRequest(0, [request("eth_chainId")])).toThrow();
    expect(() => validateRpcRequest(0, { ...request("eth_chainId"), url: "https://internal" })).toThrow();
    expect(() => validateRpcRequest(5, request("eth_chainId"))).toThrow();
    expect(() => validateRpcRequest(0, request("getGenesisHash"))).toThrow();
    expect(() => validateRpcRequest(5, request("getSignatureStatuses", [Array(11).fill("1".repeat(64)), { searchTransactionHistory: true }]))).toThrow();
    expect(() => validateRpcRequest(5, request("sendTransaction", ["AAAA", { encoding: "base64", skipPreflight: true }]))).toThrow();
  });
});
