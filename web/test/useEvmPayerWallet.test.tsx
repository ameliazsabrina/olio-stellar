// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEvmPayerWallet } from "../src/features/cctpPayer/hooks/useEvmPayerWallet";
import { EVM_SOURCES } from "../src/lib/cctp";

afterEach(() => vi.unstubAllGlobals());

it("connects, switches to Base, tracks wallet changes and cleans up listeners", async () => {
  let chain = "0xaa36a7";
  const address = `0x${"11".repeat(20)}`;
  const listeners = new Map<string, (value: never) => void>();
  const removeListener = vi.fn();
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts")
      return [address];
    if (method === "eth_chainId") return chain;
    if (method === "wallet_switchEthereumChain") {
      chain = "0x14a34";
      return null;
    }
    throw new Error(`Unexpected method ${method}`);
  });
  vi.stubGlobal("ethereum", {
    request,
    on: (event: string, listener: (value: never) => void) =>
      listeners.set(event, listener),
    removeListener,
  });
  const { result, unmount } = renderHook(() =>
    useEvmPayerWallet(EVM_SOURCES[6]),
  );
  await waitFor(() => expect(result.current.address).toBe(address));
  expect(request).not.toHaveBeenCalledWith(
    expect.objectContaining({ method: "eth_requestAccounts" }),
  );
  expect(result.current.onExpectedChain).toBe(false);
  await act(async () => {
    await result.current.connect();
  });
  expect(result.current.address).toBe(address);
  expect(result.current.onExpectedChain).toBe(true);
  act(() => {
    listeners.get("chainChanged")?.("0xaa36a7" as never);
    listeners.get("accountsChanged")?.([] as never);
  });
  expect(result.current.address).toBeNull();
  expect(result.current.onExpectedChain).toBe(false);
  unmount();
  expect(removeListener).toHaveBeenCalledTimes(2);
});

it("reports a missing wallet only after connect", async () => {
  vi.stubGlobal("ethereum", undefined);
  const { result } = renderHook(() => useEvmPayerWallet(EVM_SOURCES[6]));
  expect(result.current.error).toBeNull();
  await act(async () => {
    await result.current.connect();
  });
  expect(result.current.error).toMatch(/No EVM wallet found/);
  expect(result.current.connecting).toBe(false);
});
