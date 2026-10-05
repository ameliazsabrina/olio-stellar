"use client";

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
  provisionBridge,
  type RampSession,
  releaseNoteToBridge,
  type StrandedBridge,
} from "./bridge";
