import type { inferRouterOutputs } from "@trpc/server";
import { anchorRouter } from "./modules/anchor/anchor.router";
import { bridgeRouter } from "./modules/bridge/bridge.router";
import { cctpRouter } from "./modules/cctp/cctp.router";
import { depositsRouter } from "./modules/deposits/deposits.router";
import { passkeyRouter } from "./modules/passkey/passkey.router";
import { paymentLinksRouter } from "./modules/paymentLinks/paymentLinks.router";
import { usernamesRouter } from "./modules/usernames/usernames.router";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  passkey: passkeyRouter,
  deposits: depositsRouter,
  usernames: usernamesRouter,
  paymentLinks: paymentLinksRouter,
  cctp: cctpRouter,
  bridge: bridgeRouter,
  anchor: anchorRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
