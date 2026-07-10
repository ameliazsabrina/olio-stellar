import { depositsRouter } from "./modules/deposits/deposits.router";
import { passkeyRouter } from "./modules/passkey/passkey.router";
import { usernamesRouter } from "./modules/usernames/usernames.router";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  passkey: passkeyRouter,
  deposits: depositsRouter,
  usernames: usernamesRouter,
});

export type AppRouter = typeof appRouter;
