// @vitest-environment node
import { TRPCError } from "@trpc/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  username: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("../src/server/modules/verification/verification.submission", () => ({
  requireSubmission: mocks.guard,
}));
vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  usernameByOwner: mocks.username,
}));
vi.mock("../src/server/modules/paymentLinks/paymentLinks.service", () => ({
  getLink: mocks.get,
  createLink: mocks.create,
  updateLink: mocks.update,
  setLinkArchived: mocks.archive,
  deleteLink: mocks.remove,
  claimLinkForBusiness: mocks.claim,
  listLinksByOwner: vi.fn(),
  resolveLink: vi.fn(),
}));
import { paymentLinksRouter } from "../src/server/modules/paymentLinks/paymentLinks.router";
const caller = (user: string | null = "user") =>
  paymentLinksRouter.createCaller({
    ip: null,
    authToken: user,
    privyUserId: user,
    privyClaim: user ? ({ user_id: user } as any) : null,
    authError: null,
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ contractId: "account" });
  mocks.username.mockResolvedValue("alice");
  mocks.get.mockResolvedValue({ owner: "alice" });
  mocks.remove.mockResolvedValue(true);
});
it("rejects anonymous management-token mutations", async () => {
  await expect(
    caller(null).delete({ id: "link", manageToken: "valid-token" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("requires submitted account and authenticated ownership before token checks", async () => {
  mocks.guard.mockRejectedValue(
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "VERIFICATION_SUBMISSION_REQUIRED",
    }),
  );
  await expect(
    caller().delete({ id: "link", manageToken: "valid-token" }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("rejects mutations of another account's links despite possession of the token", async () => {
  mocks.get.mockResolvedValue({ owner: "bob" });
  await expect(
    caller().delete({ id: "link", manageToken: "valid-token" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller().create({
      username: "bob",
      slug: "invoice",
      amount: "1",
      description: null,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("preserves the existing management-token check after ownership authorization", async () => {
  await expect(
    caller().delete({ id: "link", manageToken: "original-token" }),
  ).resolves.toBe(true);
  expect(mocks.remove).toHaveBeenCalledWith({
    id: "link",
    manageToken: "original-token",
  });
});
