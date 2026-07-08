import { createTRPCRouter } from "./trpc";
import { depositsRouter } from "./modules/deposits/deposits.router";
import { privyRouter } from "./modules/privy/privy.router";
import { usernamesRouter } from "./modules/usernames/usernames.router";

export const appRouter = createTRPCRouter({
  privy: privyRouter,
  deposits: depositsRouter,
  usernames: usernamesRouter
});

export type AppRouter = typeof appRouter;
