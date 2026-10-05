import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { listNotifications, markRead } from "./notifications.service";
export const notificationsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          accountKey: z.string().max(128).optional(),
          cursor: z.string().max(500).nullish(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .default({ limit: 20 }),
    )
    .query(({ ctx, input }) =>
      listNotifications(
        ctx.privyUserId,
        input.cursor ?? undefined,
        input.limit,
      ),
    ),
  markRead: protectedProcedure
    .input(z.object({ id: z.string().max(200) }))
    .mutation(({ ctx, input }) => markRead(ctx.privyUserId, input.id)),
  markAllRead: protectedProcedure.mutation(({ ctx }) =>
    markRead(ctx.privyUserId),
  ),
});
