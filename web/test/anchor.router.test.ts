import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import {
  AnchorBridgeError,
  AnchorChallengeError,
  AnchorConfigError,
} from "../src/server/modules/anchor/anchor.errors";

const signClientChallenge = vi.hoisted(() => vi.fn());

vi.mock("../src/server/modules/anchor/anchor.service", () => ({
  signClientChallenge,
}));

import { anchorRouter } from "../src/server/modules/anchor/anchor.router";

beforeEach(() => {
  __resetRateLimit();
  signClientChallenge.mockReset();
  signClientChallenge.mockResolvedValue({
    signedTransactionXdr: "signed-xdr",
  });
});

it("validates input and returns the signed challenge", async () => {
  const caller = anchorRouter.createCaller({ ip: "203.0.113.10" });
  const input = {
    transactionXdr: "challenge-xdr",
    bridgePublicKey: Keypair.random().publicKey(),
  };
  await expect(caller.signClientChallenge(input)).resolves.toEqual({
    signedTransactionXdr: "signed-xdr",
  });
  expect(signClientChallenge).toHaveBeenCalledWith(input);
});

it("rate limits client-domain signing", async () => {
  const caller = anchorRouter.createCaller({ ip: null });
  for (let i = 0; i < 10; i += 1) {
    await caller.signClientChallenge({
      transactionXdr: "xdr",
      bridgePublicKey: Keypair.random().publicKey(),
    });
  }
  await expect(
    caller.signClientChallenge({
      transactionXdr: "xdr",
      bridgePublicKey: Keypair.random().publicKey(),
    }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

it("maps configuration, bridge, and challenge failures", async () => {
  const caller = anchorRouter.createCaller({ ip: "203.0.113.11" });
  const input = {
    transactionXdr: "xdr",
    bridgePublicKey: Keypair.random().publicKey(),
  };

  signClientChallenge.mockRejectedValueOnce(new AnchorConfigError("config"));
  await expect(caller.signClientChallenge(input)).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });

  signClientChallenge.mockRejectedValueOnce(new AnchorBridgeError("bridge"));
  await expect(caller.signClientChallenge(input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });

  signClientChallenge.mockRejectedValueOnce(
    new AnchorChallengeError("challenge"),
  );
  await expect(caller.signClientChallenge(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});
