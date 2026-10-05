import { notificationsRouter } from "./modules/notifications/notifications.router";
import type { inferRouterOutputs } from "@trpc/server";
import { aiDraftsRouter } from "./modules/aiDrafts/aiDrafts.router";
import { bridgeRouter } from "./modules/bridge/bridge.router";
import { businessesRouter } from "./modules/businesses/businesses.router";
import { cctpRouter } from "./modules/cctp/cctp.router";
import { channelsRouter } from "./modules/channels/channels.router";
import { depositsRouter } from "./modules/deposits/deposits.router";
import { feeQuotesRouter } from "./modules/feeQuotes/feeQuotes.router";
import { passportRouter } from "./modules/passport/passport.router";
import { paymentLinksRouter } from "./modules/paymentLinks/paymentLinks.router";
import { usernamesRouter } from "./modules/usernames/usernames.router";
import { verificationRouter } from "./modules/verification/verification.router";
import { walletsRouter } from "./modules/wallets/wallets.router";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  notifications: notificationsRouter,
  aiDrafts: aiDraftsRouter,
  deposits: depositsRouter,
  feeQuotes: feeQuotesRouter,
  usernames: usernamesRouter,
  paymentLinks: paymentLinksRouter,
  cctp: cctpRouter,
  bridge: bridgeRouter,
  channels: channelsRouter,
  wallets: walletsRouter,
  businesses: businessesRouter,
  verification: verificationRouter,
  passport: passportRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
