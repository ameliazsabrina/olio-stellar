import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let version = 0;
const now = new Date().toISOString();
const wallet = {
  address: "fixture-account",
  authenticated: true,
  sessionReady: true,
  username: "alice",
  accountUnlocked: true,
  connecting: false,
  pinModalOpen: false,
  usernameModalOpen: false,
  disconnect: async () => {},
};
let business: any = null;
let submitted = false;
let read = false;
function change() {
  version++;
  listeners.forEach((fn) => fn());
}
function useStateVersion() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => version,
  );
}
const status = () => ({
  businessId: "fixture-business",
  type: business?.type ?? "individual",
  firstSubmittedAt: submitted ? now : null,
  eligibility: submitted ? "pending" : "not_started",
  nextAction: submitted ? "wait" : "continue",
  userMessage: submitted ? "Your verification is under review." : null,
});
export const useWallet = () => {
  useStateVersion();
  return wallet;
};
const refresh = async () => {};
const utils = {
  verification: {
    onboarding: { invalidate: refresh },
    status: { invalidate: refresh },
  },
  notifications: { list: { invalidate: refresh } },
};
const mutation = (fn: any) => ({
  useMutation: () => ({ mutateAsync: fn, isPending: false }),
});
export const trpc = {
  useUtils: () => utils,
  verification: {
    onboarding: {
      useQuery: () => {
        useStateVersion();
        return {
          data: {
            business,
            status: business ? status() : null,
            submitted,
            serviceAvailable: true,
          },
          refetch: refresh,
        };
      },
    },
    status: { useQuery: () => ({ data: status() }) },
    start: mutation(refresh),
    refresh: mutation(refresh),
    sdkToken: mutation(async () => ({ token: "fixture" })),
  },
  businesses: {
    create: mutation(async (input: any) => {
      business = { businessId: "fixture-business", ...input };
      change();
      return business;
    }),
    bindAccount: mutation(refresh),
    updateProfile: mutation(refresh),
  },
  notifications: {
    list: {
      useInfiniteQuery: () => {
        useStateVersion();
        return {
          data: {
            pages: [
              {
                unreadCount: read ? 0 : 1,
                items: [
                  {
                    id: "notice",
                    businessId: "fixture-business",
                    message: "Your verification is under review.",
                    read,
                    createdAt: now,
                  },
                ],
              },
            ],
          },
        };
      },
    },
    markRead: mutation(async () => {
      read = true;
      change();
    }),
    markAllRead: mutation(async () => {
      read = true;
      change();
    }),
  },
};
export function SumsubVerification({
  onSubmitted,
}: {
  onSubmitted: () => void;
}) {
  return (
    <div className="rounded-xl border p-4">
      <iframe
        title="Provider document collection fixture"
        className="h-64 w-full"
        srcDoc="<html><body style='font:16px sans-serif'><h2>Secure document collection</h2><p>Provider iframe fixture</p><input aria-label='Document reference'></body></html>"
      />
      <button
        className="mt-3 rounded-full bg-black px-4 py-2 text-white"
        onClick={onSubmitted}
      >
        Submit provider documents
      </button>
    </div>
  );
}
(window as any).verificationQA = {
  confirm: () => {
    submitted = true;
    change();
  },
};

// Stand-ins for Next-only modules the controller imports.
// A saved preference is simulated through window.__themePreference.
export const useDashboardTheme = () => {
  const preference =
    (window as { __themePreference?: "painting" | "dark" })
      .__themePreference ?? null;
  return {
    theme: preference ?? ("painting" as const),
    preference,
    setTheme: () => {},
    toggleTheme: () => {},
  };
};
export default function Image({
  src,
  alt,
  width,
  height,
  className,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
    />
  );
}
