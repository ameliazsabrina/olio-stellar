import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount any React trees rendered during a test so DOM state doesn't leak
// between cases. No-op for node-environment (server) tests.
afterEach(() => {
  cleanup();
});
