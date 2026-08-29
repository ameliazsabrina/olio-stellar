// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BalanceCard } from "../src/components/dashboard/BalanceCard";

describe("BalanceCard currency selector", () => {
  it("opens the stablecoin chooser from the USDC footer control", async () => {
    const user = userEvent.setup();
    render(
      <BalanceCard
        claimable={0n}
        loading={false}
        onReceive={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Choose balance currency" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: /USDC Active/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /EURC Coming soon/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps receive available without exposing an Add cash control", async () => {
    const onReceive = vi.fn();
    render(
      <BalanceCard claimable={10n} loading={false} onReceive={onReceive} />,
    );

    expect(
      screen.queryByRole("button", { name: "Add cash" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Receive payment" }),
    );
    expect(onReceive).toHaveBeenCalledOnce();
  });
});
