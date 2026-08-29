// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getEscrow: vi.fn(),
  mutateAsync: vi.fn(),
  invalidate: vi.fn(),
  rotateEscrow: vi.fn(),
  verifyEscrowPin: vi.fn(),
}));
vi.mock("../src/trpc/client", () => ({
  api: { wallets: { getEscrow: { query: mocks.getEscrow } } },
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      wallets: { getEscrow: { invalidate: mocks.invalidate } },
    }),
    wallets: {
      rotateEscrow: {
        useMutation: () => ({
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock("../src/lib/keys", () => ({
  rotateEscrow: mocks.rotateEscrow,
  verifyEscrowPin: mocks.verifyEscrowPin,
}));

import {
  RecoveryNotConfiguredError,
  RecoveryPinChangeError,
  RecoveryRevisionConflictError,
  useChangeRecoveryPin,
} from "../src/features/recovery/hooks/useChangeRecoveryPin";

const current = {
  encryptedMasterHex: "aa".repeat(60),
  masterSaltHex: "bb".repeat(16),
  kdfParams: { m: 19_456, t: 2, p: 1 },
  revision: 3,
};
const replacement = {
  encryptedMasterHex: "cc".repeat(60),
  masterSaltHex: "dd".repeat(16),
  kdfParams: { m: 19_456, t: 2, p: 1 },
};

describe("useChangeRecoveryPin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEscrow.mockResolvedValue(current);
    mocks.rotateEscrow.mockReturnValue(replacement);
    mocks.mutateAsync.mockResolvedValue({ revision: 4 });
  });

  it("fetches fresh escrow, rotates locally, mutates by revision, and invalidates", async () => {
    const { result } = renderHook(() => useChangeRecoveryPin());
    await act(() => result.current.changeRecoveryPin("123456", "654321"));

    expect(mocks.getEscrow).toHaveBeenCalledTimes(1);
    expect(mocks.rotateEscrow).toHaveBeenCalledWith(
      current,
      "123456",
      "654321",
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      expectedRevision: 3,
      escrow: replacement,
    });
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it("checks the current PIN locally without sending a rotation mutation", async () => {
    const { result } = renderHook(() => useChangeRecoveryPin());
    await expect(result.current.validateCurrentPin("123456")).resolves.toBe(
      true,
    );
    expect(mocks.verifyEscrowPin).toHaveBeenCalledWith(current, "123456");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("does not mutate when recovery is missing", async () => {
    mocks.getEscrow.mockResolvedValue(null);
    const { result } = renderHook(() => useChangeRecoveryPin());
    await expect(
      act(() => result.current.changeRecoveryPin("123456", "654321")),
    ).rejects.toBeInstanceOf(RecoveryNotConfiguredError);
    expect(mocks.rotateEscrow).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("translates stale revisions into a stable conflict", async () => {
    mocks.mutateAsync.mockRejectedValue({ data: { code: "CONFLICT" } });
    const { result } = renderHook(() => useChangeRecoveryPin());
    await expect(
      act(() => result.current.changeRecoveryPin("123456", "654321")),
    ).rejects.toBeInstanceOf(RecoveryRevisionConflictError);
  });

  it("reconciles a lost success response by matching the committed replacement", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("connection lost"));
    mocks.getEscrow
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...replacement, revision: 4 });
    const { result } = renderHook(() => useChangeRecoveryPin());
    await act(async () => {
      await result.current.changeRecoveryPin("123456", "654321");
    });
    expect(mocks.getEscrow).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it("reports a stable retryable error when reconciliation cannot confirm", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("connection lost"));
    mocks.getEscrow
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error("still offline"));
    const { result } = renderHook(() => useChangeRecoveryPin());
    await expect(
      act(() => result.current.changeRecoveryPin("123456", "654321")),
    ).rejects.toBeInstanceOf(RecoveryPinChangeError);
  });
});
