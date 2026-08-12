// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalLinkCard } from "../src/components/dashboard/PersonalLinkCard";

describe("personal payment link actions", () => {
  it("shows the payment URL and opens the branded QR action", async () => {
    const user = userEvent.setup();
    const payLink = "https://olio.example/pay/olio";
    render(<PersonalLinkCard username="olio" payLink={payLink} />);

    expect(screen.getByText("olio.example/pay/olio")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open payment link" }),
    ).toHaveAttribute("href", payLink);

    const trigger = screen.getByRole("button", {
      name: "Show payment QR code",
    });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Payment link QR code",
    });
    expect(dialog.querySelector('path[fill="#1A1F12"]')).toBeInTheDocument();
    expect(dialog.querySelector('path[fill="#F5F3EA"]')).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
