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

describe("AppShell", () => {
  it("keeps the product marker off the landing page", () => {
    mocks.pathname = "/";
    const { container } = render(<AppShell>Landing content</AppShell>);

    expect(container.querySelector(".theme-product")).toBeNull();
    expect(container.querySelector("[data-product-theme]")).toBeNull();
  });

  it.each([
    "/dashboard",
    "/pay/alice",
    "/not-protected",
  ])("marks product route %s for scoped and portal theming", (pathname) => {
    mocks.pathname = pathname;
    const { container } = render(<AppShell>Product content</AppShell>);

    expect(container.querySelector("[data-product-theme]")).toHaveClass(
      "theme-product",
      "contents",
    );
  });

  it("does not introduce a second main landmark", () => {
    render(
      <AppShell>
        <main id="main-content">Protected content</main>
      </AppShell>,
    );

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("has no integration announcement", () => {
    render(<AppShell>Protected content</AppShell>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
