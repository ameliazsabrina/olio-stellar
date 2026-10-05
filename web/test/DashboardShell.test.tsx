// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../src/components/dashboard/NotificationInbox", () => ({
  NotificationInbox: () => <button aria-label="Notifications" />,
}));

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  usePathname: vi.fn(() => "/dashboard"),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ username: "toreno", disconnect: mocks.disconnect }),
}));

import { DashboardShell } from "../src/components/dashboard/DashboardShell";

describe("DashboardShell navigation", () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue("/dashboard");
  });

  it("provides the page's main-content landmark", () => {
    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("uses an unframed wordmark and grouped account controls without duplicate route navigation", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell navigation>
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    expect(screen.getByRole("link", { name: "Olio home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Use dark dashboard theme",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.queryByRole("navigation", { name: "Dashboard navigation" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "@toreno account menu" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Sign out" }),
    ).toHaveClass(
      "bg-brand-linen/10",
      "!text-brand-linen",
      "focus:!text-brand-linen",
    );
  });

  it("keeps the dashboard chrome mounted while the route content changes", () => {
    const { rerender } = render(
      <DashboardShell navigation>
        <div>Overview content</div>
      </DashboardShell>,
    );
    const accountMenu = document.querySelector(
      "#dashboard-account-menu-trigger",
    );
    expect(
      screen.queryByRole("link", { name: "Back to dashboard" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Olio home" })).toHaveAttribute(
      "href",
      "/",
    );

    mocks.usePathname.mockReturnValue("/history");
    rerender(
      <DashboardShell navigation>
        <div>History content</div>
      </DashboardShell>,
    );

    expect(document.querySelector("#dashboard-account-menu-trigger")).toBe(
      accountMenu,
    );
    expect(
      screen.getByRole("link", { name: "Back to dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Olio home" })).toBeNull();
    expect(screen.getByText("History")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("History content")).toBeInTheDocument();
  });
});
