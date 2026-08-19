// @vitest-environment node
import type { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../src/server/trpc";

const router = createTRPCRouter({
  whoami: protectedProcedure.query(({ ctx }) => ctx.privyUserId),
});

describe("Privy protectedProcedure", () => {
  it("rejects a missing or invalid session", async () => {
    const caller = router.createCaller({
      ip: null,
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: new Error("expired"),
    });
    await expect(caller.whoami()).rejects.toMatchObject<Partial<TRPCError>>({
      code: "UNAUTHORIZED",
    });
  });

  it("uses the verified Privy DID instead of caller input", async () => {
    const claim = {
      app_id: "app",
      issuer: "privy.io",
      issued_at: 1,
      expiration: 2,
      session_id: "s",
      user_id: "did:privy:verified",
    };
    const caller = router.createCaller({
      ip: null,
      authToken: "token",
      privyUserId: claim.user_id,
      privyClaim: claim,
      authError: null,
    });
    await expect(caller.whoami()).resolves.toBe(claim.user_id);
  });
});
