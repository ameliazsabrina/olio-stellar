// @vitest-environment happy-dom
import { Asset } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/trpc/client", () => ({
  api: { bridge: { fund: { mutate: vi.fn() } } },
}));
vi.mock("../src/lib/anchor", () => ({
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

it("persists and updates a versioned ramp session before reload", async () => {
  const {
    createBridge,
    listRampSessions,
    persistRampSession,
    updateRampSession,
  } = await import("../src/lib/bridge");
  const bridge = createBridge();
  persistRampSession(bridge, {
    mgiId: "mgi-1",
    kind: "cash-out",
    amount: 150_000_000n,
    status: "pending_user_transfer_start",
  });
  updateRampSession("mgi-1", {
    status: "pending_user_transfer_complete",
    stellarHash: "stellar-hash",
  });
  expect(listRampSessions()).toEqual([
    expect.objectContaining({
      version: 1,
      mgiId: "mgi-1",
      kind: "cash-out",
      publicKey: bridge.publicKey,
      amount: "150000000",
      status: "pending_user_transfer_complete",
      stellarHash: "stellar-hash",
    }),
  ]);
});

it("keeps legacy bridge records readable beside new ramp sessions", async () => {
  const {
    createBridge,
    listStrandedBridges,
    persistBridge,
    persistRampSession,
  } = await import("../src/lib/bridge");
  const legacy = createBridge();
  const ramp = createBridge();
  persistBridge(legacy, "legacy-withdrawal", 1n);
  persistRampSession(ramp, {
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
    persistRampSession,
  } = await import("../src/lib/bridge");
  persistRampSession(createBridge(), {
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
