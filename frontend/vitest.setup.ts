import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount any React trees rendered during a test so DOM state doesn't leak
// between cases. No-op for node-environment (server) tests.
afterEach(() => {
  cleanup();
});
