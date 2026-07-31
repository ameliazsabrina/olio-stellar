// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("../src/lib/moneygram-status", () => ({
  moneyGramBannerCopy: "MoneyGram integration is in progress.",
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    usernameModalOpen: false,
    closeUsernameModal: vi.fn(),
    pinModalOpen: false,
    pinMode: "unlock",
    pinSubmitting: false,
    pinError: null,
    submitPin: vi.fn(),
    closePinModal: vi.fn(),
  }),
}));
vi.mock("../src/components/PinDialog", () => ({
  PinDialog: () => null,
}));
vi.mock("../src/components/UsernameModal", () => ({
  UsernameModal: () => null,
}));
vi.mock("../src/components/dashboard/DashboardBackground", () => ({
  DashboardBackground: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/components/dashboard/DashboardShell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => children,
}));

import { AppShell } from "../src/components/AppShell";

beforeEach(() => {
  mocks.pathname = "/dashboard";
});

describe("AppShell MoneyGram announcement", () => {
  it("shows the linked announcement on middleware-protected routes", () => {
    render(<AppShell>Protected content</AppShell>);

    expect(
      screen.getByRole("status", { name: "MoneyGram integration status" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Get to know about MoneyGram" }),
    ).toHaveAttribute("href", "https://www.moneygram.com/us/en/ramps");
    expect(
      screen.getByRole("link", { name: "Get to know about MoneyGram" }),
    ).toHaveClass("underline");
  });

  it.each([
    "/",
    "/pay/alice",
    "/not-protected",
  ])("does not show the announcement on public route %s", (pathname) => {
    mocks.pathname = pathname;
    render(<AppShell>Public content</AppShell>);

    expect(
      screen.queryByRole("status", {
        name: "MoneyGram integration status",
      }),
    ).not.toBeInTheDocument();
  });
});
