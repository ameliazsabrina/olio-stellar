import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import {
  BridgeConfigError,
  BridgeFundError,
} from "../src/server/modules/bridge/bridge.errors";

const fundBridge = vi.hoisted(() => vi.fn());

vi.mock("../src/server/modules/bridge/bridge.service", () => ({
  fundBridge,
}));

import { bridgeRouter } from "../src/server/modules/bridge/bridge.router";

beforeEach(() => {
  __resetRateLimit();
  fundBridge.mockReset();
  fundBridge.mockResolvedValue({ funded: true, txHash: "hash" });
});

it("validates bridge keys and returns the service output", async () => {
  const caller = bridgeRouter.createCaller({ ip: "203.0.113.1" });
  const bridgePublicKey = Keypair.random().publicKey();

  await expect(caller.fund({ bridgePublicKey })).resolves.toEqual({
    funded: true,
    txHash: "hash",
  });
  expect(fundBridge).toHaveBeenCalledWith({ bridgePublicKey });
  await expect(
    caller.fund({ bridgePublicKey: "not-a-key" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rate limits callers even when the request IP is unavailable", async () => {
  const caller = bridgeRouter.createCaller({ ip: null });
  for (let i = 0; i < 10; i += 1) {
    await caller.fund({ bridgePublicKey: Keypair.random().publicKey() });
  }

  await expect(
    caller.fund({ bridgePublicKey: Keypair.random().publicKey() }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

it("maps configuration and Horizon failures at the router boundary", async () => {
  const caller = bridgeRouter.createCaller({ ip: "203.0.113.2" });
  const bridgePublicKey = Keypair.random().publicKey();
  fundBridge.mockRejectedValueOnce(new BridgeConfigError("missing config"));
  await expect(caller.fund({ bridgePublicKey })).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "missing config",
  });

  fundBridge.mockRejectedValueOnce(new BridgeFundError("Horizon unavailable"));
  await expect(caller.fund({ bridgePublicKey })).rejects.toMatchObject({
    code: "BAD_GATEWAY",
    message: "Horizon unavailable",
  });
});
