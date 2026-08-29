// @vitest-environment node
import type { TRPCError } from "@trpc/server";

const mocks = vi.hoisted(() => ({
  rotateEscrow: vi.fn(),
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  bootstrapWallet: vi.fn(),
  currentWallet: vi.fn(),
  getEscrow: vi.fn(),
  restoreWallet: vi.fn(),
  rotateEscrow: mocks.rotateEscrow,
  saveEscrow: vi.fn(),
}));

import {
  WalletEscrowMissingError,
  WalletEscrowRevisionConflictError,
} from "../src/server/modules/wallets/wallets.errors";
import { walletsRouter } from "../src/server/modules/wallets/wallets.router";

const claim = {
  app_id: "app",
  issuer: "privy.io",
  issued_at: 1,
  expiration: 2,
  session_id: "session",
  user_id: "did:privy:authenticated",
};
const validInput = {
  expectedRevision: 2,
  escrow: {
    encryptedMasterHex: "aa".repeat(60),
    masterSaltHex: "bb".repeat(16),
    kdfParams: { m: 19_456, t: 2, p: 1 },
  },
};

function caller(authenticated = true) {
  return walletsRouter.createCaller({
    ip: null,
    authToken: authenticated ? "token" : null,
    privyUserId: authenticated ? claim.user_id : null,
    privyClaim: authenticated ? claim : null,
    authError: null,
  });
}

describe("wallet escrow rotation router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a protected Privy session", async () => {
    await expect(caller(false).rotateEscrow(validInput)).rejects.toMatchObject<
      Partial<TRPCError>
    >({ code: "UNAUTHORIZED" });
    expect(mocks.rotateEscrow).not.toHaveBeenCalled();
  });

  it("validates exact transport sizes and safe KDF bounds", async () => {
    await expect(
      caller().rotateEscrow({
        ...validInput,
        escrow: { ...validInput.escrow, encryptedMasterHex: "aa" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().rotateEscrow({
        ...validInput,
        escrow: {
          ...validInput.escrow,
          kdfParams: { m: Number.MAX_SAFE_INTEGER, t: 2, p: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.rotateEscrow).not.toHaveBeenCalled();
  });

  it("passes only the authenticated identity and returns the new revision", async () => {
    mocks.rotateEscrow.mockResolvedValue({ revision: 3 });
    await expect(caller().rotateEscrow(validInput)).resolves.toEqual({
      revision: 3,
    });
    expect(mocks.rotateEscrow).toHaveBeenCalledWith(claim.user_id, validInput);
  });

  it("maps missing escrow to PRECONDITION_FAILED", async () => {
    mocks.rotateEscrow.mockRejectedValue(new WalletEscrowMissingError());
    await expect(caller().rotateEscrow(validInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("maps revision conflicts to CONFLICT", async () => {
    mocks.rotateEscrow.mockRejectedValue(
      new WalletEscrowRevisionConflictError(),
    );
    await expect(caller().rotateEscrow(validInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
