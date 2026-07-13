// @vitest-environment node
import { TRPCError } from "@trpc/server";
import {
  RegistryLookupFailedError,
  UsernameNotOnChainError,
} from "../src/server/modules/usernames/usernames.errors";

const mocks = vi.hoisted(() => ({
  registerUsernameCache: vi.fn(),
  resolveUsername: vi.fn(),
  usernameByOwner: vi.fn(),
}));

vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  registerUsernameCache: mocks.registerUsernameCache,
  resolveUsername: mocks.resolveUsername,
  usernameByOwner: mocks.usernameByOwner,
}));

import { usernamesRouter } from "../src/server/modules/usernames/usernames.router";

const caller = usernamesRouter.createCaller({ token: null });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usernames.register mutation", () => {
  it("returns the service result on success", async () => {
    const payload = {
      owner: "GCTESTOWNER",
      notePubkeyHex: "ab".repeat(32),
      viewPubkeyHex: "cd".repeat(32),
      createdAt: new Date(0).toISOString(),
    };
    mocks.registerUsernameCache.mockResolvedValue(payload);

    await expect(caller.register({ username: "alice" })).resolves.toEqual(
      payload,
    );
    expect(mocks.registerUsernameCache).toHaveBeenCalledWith("alice");
  });

  it("maps UsernameNotOnChainError to a PRECONDITION_FAILED TRPCError", async () => {
    mocks.registerUsernameCache.mockRejectedValue(
      new UsernameNotOnChainError(),
    );

    await expect(caller.register({ username: "alice" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("rejects an invalid username before touching the service", async () => {
    // Uppercase / too short both violate the shared usernameSchema.
    await expect(caller.register({ username: "AB" })).rejects.toBeInstanceOf(
      TRPCError,
    );
    expect(mocks.registerUsernameCache).not.toHaveBeenCalled();
  });
});

describe("usernames.resolve query error mapping", () => {
  it("maps RegistryLookupFailedError to INTERNAL_SERVER_ERROR", async () => {
    mocks.resolveUsername.mockRejectedValue(new RegistryLookupFailedError());

    await expect(caller.resolve({ username: "alice" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
