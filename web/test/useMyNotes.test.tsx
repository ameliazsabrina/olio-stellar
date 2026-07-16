// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMyNotes } from "../src/components/dashboard/useMyNotes";

const mocks = vi.hoisted(() => ({
  scanMyNotes: vi.fn(),
}));

vi.mock("../src/lib/notes", () => ({
  getAccount: vi.fn(() => ({ ownerSecret: 1n, viewSk: new Uint8Array(32) })),
  scanMyNotes: mocks.scanMyNotes,
}));

const result = {
  notes: [{ leafIndex: 1, amount: 5_000_000n, salt: 2n, spent: false }],
  leaves: [1n],
  claimable: 5_000_000n,
  mirrorAvailable: true,
  indexedAt: new Date().toISOString(),
  health: "healthy" as const,
};

function Harness() {
  const state = useMyNotes("CACCOUNT");
  return (
    <div>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="refreshing">{String(state.refreshing)}</span>
      <span data-testid="balance">{state.claimable.toString()}</span>
    </div>
  );
}

describe("useMyNotes", () => {
  beforeEach(() => {
    mocks.scanMyNotes.mockReset();
  });

  it("keeps the previous balance visible during a background refresh", async () => {
    mocks.scanMyNotes
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce(result);
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("balance")).toHaveTextContent("5000000"),
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");

    let resolveRefresh!: (value: typeof result) => void;
    mocks.scanMyNotes.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));

    await waitFor(() =>
      expect(screen.getByTestId("refreshing")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("balance")).toHaveTextContent("5000000");

    await act(async () => resolveRefresh(result));
  });
});
