"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";

type ToastFeedbackProps = {
  message?: string | null;
  /** Optional rich body rendered in place of `message` (e.g. with inline links). `message` is still used as the toast key. */
  content?: ReactNode;
  title?: string;
  variant?: "error" | "info" | "success";
  toastId?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
};

function ToastFeedback({
  message,
  content,
  title,
  variant = "info",
  toastId,
  action,
}: ToastFeedbackProps) {
  const actionLabel = action?.label;
  const actionHref = action?.href;
  const actionOnClick = action?.onClick;
  const actionOnClickRef = useRef(actionOnClick);
  actionOnClickRef.current = actionOnClick;

  // biome-ignore lint/correctness/useExhaustiveDependencies: rich content is derived from message; message is the stable event key.
  useEffect(() => {
    if (!message) return;

    toast[variant](title ?? content ?? message, {
      id: toastId,
      description: title ? (content ?? message) : undefined,
      action:
        actionLabel && (actionOnClickRef.current || actionHref)
          ? {
              label: actionLabel,
              onClick: () => {
                if (actionOnClickRef.current) {
                  actionOnClickRef.current();
                  return;
                }
                if (actionHref) {
                  window.open(actionHref, "_blank", "noopener,noreferrer");
                }
              },
            }
          : undefined,
    });
  }, [actionHref, actionLabel, message, title, toastId, variant]);

  return null;
}

export { ToastFeedback };
