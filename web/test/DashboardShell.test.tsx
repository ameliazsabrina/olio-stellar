// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
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

  it("shows the side rail, greeting, theme button and account menu", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell navigation>
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    expect(
      screen.getByRole("heading", { name: "Hello, toreno" }),
    ).toBeInTheDocument();
    const rail = screen.getByRole("navigation", {
      name: "Dashboard navigation",
    });
    expect(within(rail).getByRole("link", { name: "Olio home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(rail).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [name, href] of [
      ["Payment links", "/links"],
      ["Payments", "/history"],
      ["Withdraw", "/withdraw"],
      ["Settings", "/settings"],
    ]) {
      expect(within(rail).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    ).toBeInTheDocument();

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

    mocks.usePathname.mockReturnValue("/history");
    rerender(
      <DashboardShell navigation>
        <div>History content</div>
      </DashboardShell>,
    );

    expect(document.querySelector("#dashboard-account-menu-trigger")).toBe(
      accountMenu,
    );
    const rail = screen.getByRole("navigation", {
      name: "Dashboard navigation",
    });
    expect(within(rail).getByRole("link", { name: "Payments" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("heading", { name: /hello/i })).toBeNull();
    expect(screen.getByText("History content")).toBeInTheDocument();
  });
});
