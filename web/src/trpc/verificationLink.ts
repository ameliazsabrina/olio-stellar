import { SUBMISSION_REQUIRED } from "../lib/verification-onboarding";
import { observable } from "@trpc/server/observable";
import type { TRPCLink } from "@trpc/client";
import type { AppRouter } from "../server/root";
import { openVerification } from "../features/verification/openVerification";
export const verificationLink: TRPCLink<AppRouter> =
  () =>
  ({ next, op }) =>
    observable((observer) =>
      next(op).subscribe({
        next: (value) => observer.next(value),
        complete: () => observer.complete(),
        error: (error) => {
          if (
            typeof window !== "undefined" &&
            error.message === SUBMISSION_REQUIRED
          )
            openVerification();
          observer.error(error);
        },
      }),
    );
