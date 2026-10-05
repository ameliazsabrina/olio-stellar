"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { trpc } from "../../trpc/react";
import { openVerification } from "../../features/verification/openVerification";
import { useWallet } from "../WalletProvider";
export function NotificationInbox() {
  const wallet = useWallet();
  return <AccountInbox key={wallet.address} />;
}
function AccountInbox() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const query = trpc.notifications.list.useInfiniteQuery(
    { accountKey: wallet.address, limit: 20 },
    {
      enabled: !!wallet.address && wallet.authenticated,
      getNextPageParam: (page) => page.nextCursor,
      refetchInterval: 15000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: "always",
    },
  );
  const read = trpc.notifications.markRead.useMutation();
  const all = trpc.notifications.markAllRead.useMutation();
  const count = query.data?.pages[0]?.unreadCount ?? 0;
  async function mark(id?: string, businessId?: string) {
    try {
      if (id) await read.mutateAsync({ id });
      else await all.mutateAsync();
      await utils.notifications.list.invalidate();
      if (businessId) {
        setOpen(false);
        openVerification(businessId);
      }
      setError("");
    } catch {
      setError("Could not update this notification. Please retry.");
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        className="relative flex size-11 items-center justify-center rounded-full bg-brand-linen/16 ring-1 ring-brand-linen/25 focus-visible:outline-none focus-visible:ring-2"
      >
        <Bell className="size-5" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-brand-linen px-1.5 text-xs font-semibold text-brand-obsidian">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          <Popover.Popup className="theme-linen w-96 max-w-[calc(100vw-2rem)] max-h-[70dvh] overflow-y-auto rounded-2xl bg-brand-linen p-4 text-brand-obsidian shadow-xl outline-none">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <Popover.Title className="font-semibold">
                Notifications
              </Popover.Title>
              <button
                className="text-sm underline disabled:opacity-50"
                disabled={all.isPending || count === 0}
                onClick={() => void mark()}
              >
                Mark all as read
              </button>
            </div>
            {query.isError || error ? (
              <p role="alert">
                {error || "Inbox unavailable. Try again shortly."}
              </p>
            ) : null}
            {!query.isLoading && !query.data?.pages[0]?.items.length && (
              <p className="text-sm">You’re all caught up.</p>
            )}
            <ul className="space-y-2">
              {query.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.id}>
                    <button
                      disabled={read.isPending}
                      onClick={() => void mark(item.id, item.businessId)}
                      className={`w-full rounded-xl p-3 text-left text-sm hover:bg-black/10 focus-visible:ring-2 ${item.read ? "bg-black/3" : "bg-black/8 font-semibold"}`}
                    >
                      {!item.read && <span className="sr-only">Unread: </span>}
                      {item.message}
                      <time
                        className="mt-1 block text-xs font-normal opacity-70"
                        dateTime={item.createdAt}
                      >
                        {new Date(item.createdAt).toLocaleString()}
                      </time>
                    </button>
                  </li>
                ))}
            </ul>
            {query.hasNextPage && (
              <button
                className="mt-3 text-sm underline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Load more
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
