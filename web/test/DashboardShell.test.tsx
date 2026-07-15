// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  it("moves dashboard navigation and account controls into a hamburger menu on mobile", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell navigation header={<h1>Dashboard</h1>}>
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    const menuButton = screen.getByRole("button", {
      name: "Open dashboard navigation",
    });
    expect(menuButton.closest("nav")).toHaveClass("sm:hidden");

    const desktopNavigation = screen
      .getAllByRole("navigation", { name: "Dashboard navigation" })
      .find((navigation) => navigation.classList.contains("sm:grid"));
    expect(desktopNavigation).toHaveClass("hidden", "sm:grid");

    await user.click(menuButton);

    for (const label of ["Overview", "Links", "Cash out", "History"]) {
      expect(
        await screen.findByRole("menuitem", { name: label }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("menuitem", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByText("@toreno")).toHaveLength(2);
    expect(
      screen.getByRole("menuitem", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Sign out" }),
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /@toreno/ })).toHaveClass(
      "hidden",
      "sm:flex",
    );
  });
});
