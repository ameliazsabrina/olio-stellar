// @vitest-environment happy-dom
import { Asset } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/trpc/client", () => ({
  api: { bridge: { fund: { mutate: vi.fn() } } },
}));
vi.mock("../src/lib/stellar-payments", () => ({
  friendbotUrl: "https://friendbot.example",
  horizon: {},
  offRampAsset: () =>
    new Asset(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    ),
}));
vi.mock("../src/lib/withdraw", () => ({ withdrawNote: vi.fn() }));

beforeEach(() => localStorage.clear());

it("keeps legacy bridge records readable beside new ramp sessions", async () => {
  const { createBridge, listStrandedBridges, persistBridge } = await import(
    "../src/lib/bridge"
  );
  const legacy = createBridge();
  const ramp = createBridge();
  persistBridge(legacy, "legacy-withdrawal", 1n);
  storeLegacySession(ramp, {
    mgiId: "mgi-deposit",
    kind: "cash-in",
    amount: 2n,
  });
  expect(
    listStrandedBridges()
      .map((row) => row.ref)
      .sort(),
  ).toEqual(["legacy-withdrawal", "mgi-deposit"]);
});

it("clears a terminal bridge key while retaining non-secret evidence", async () => {
  const {
    clearPersistedBridge,
    createBridge,
    listRampSessions,
    listStrandedBridges,
  } = await import("../src/lib/bridge");
  storeLegacySession(createBridge(), {
    mgiId: "mgi-complete",
    kind: "cash-out",
    amount: 15n,
    status: "completed",
  });
  clearPersistedBridge("mgi-complete");
  expect(listRampSessions()).toEqual([
    expect.objectContaining({ mgiId: "mgi-complete", status: "completed" }),
  ]);
  expect(listRampSessions()[0]).not.toHaveProperty("secret");
  expect(listStrandedBridges()).toEqual([]);
});

function storeLegacySession(
  bridge: { publicKey: string; keypair: { secret(): string } },
  input: { mgiId: string; kind: string; amount: bigint; status?: string },
) {
  localStorage.setItem(
    "olio.moneygram.ramp.v1." + input.mgiId,
    JSON.stringify({
      ...input,
      version: 1,
      ref: input.mgiId,
      publicKey: bridge.publicKey,
      secret: bridge.keypair.secret(),
      amount: input.amount.toString(),
      createdAt: 1,
    }),
  );
}
