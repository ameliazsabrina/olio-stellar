"use client";

import { type ReactNode, useEffect } from "react";
import { toast } from "sonner";

type ToastFeedbackProps = {
  message?: string | null;
  /** Optional rich body rendered in place of `message` (e.g. with inline links). `message` is still used as the toast key. */
  content?: ReactNode;
  variant?: "error" | "info" | "success";
  toastId?: string;
  action?: {
    label: string;
    href: string;
  };
};

function ToastFeedback({
  message,
  content,
  variant = "info",
  toastId,
  action,
}: ToastFeedbackProps) {
  const actionLabel = action?.label;
  const actionHref = action?.href;

  useEffect(() => {
    if (!message) return;

    toast[variant](content ?? message, {
      id: toastId,
      action:
        actionLabel && actionHref
          ? {
              label: actionLabel,
              onClick: () =>
                window.open(actionHref, "_blank", "noopener,noreferrer"),
            }
          : undefined,
    });
    // `content` is derived from `message`; keying only on `message` keeps the toast from re-firing on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionHref, actionLabel, message, toastId, variant]);

  return null;
}

export { ToastFeedback };
