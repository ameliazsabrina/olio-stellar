// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalLinkCard } from "../src/components/dashboard/PersonalLinkCard";

describe("payment link QR dialog", () => {
  it("opens a white QR over a dark backdrop and closes from the backdrop", async () => {
    const user = userEvent.setup();
    render(
      <PersonalLinkCard
        username="olio"
        payLink="https://olio.example/pay/olio"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Show payment QR code",
    });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Payment link QR code",
    });
    expect(dialog).toHaveClass("bg-transparent", "shadow-none", "ring-0");
    expect(dialog.querySelector('path[fill="#ffffff"]')).toBeInTheDocument();
    expect(
      dialog.querySelector('path[fill="transparent"]'),
    ).toBeInTheDocument();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toHaveClass("bg-ink/80");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(overlay as Element);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
