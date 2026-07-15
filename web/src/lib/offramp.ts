"use client";

import type { AnchorInfo } from "./anchor";

// The bridge primitives now live in ./bridge (shared with wallet cash-out).
// Re-exported here so existing off-ramp callers keep importing from ./offramp.
export {
  type Bridge,
  createBridge,
  provisionBridge,
  releaseNoteToBridge,
} from "./bridge";

export type { AnchorInfo };
