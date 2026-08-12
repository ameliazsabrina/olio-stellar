"use client";

import type { AnchorInfo } from "./anchor";

// The bridge primitives now live in ./bridge (shared with wallet cash-out).
// Re-exported here so existing off-ramp callers keep importing from ./offramp.
export {
  type Bridge,
  bridgeUsdcBalance,
  clearPersistedBridge,
  createBridge,
  dismissRampSession,
  listRampSessions,
  listStrandedBridges,
  persistBridge,
  persistRampSession,
  provisionBridge,
  type RampSession,
  releaseNoteToBridge,
  type StrandedBridge,
  updateRampSession,
} from "./bridge";

export type { AnchorInfo };
