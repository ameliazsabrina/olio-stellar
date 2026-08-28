// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalLinkCard } from "../src/components/dashboard/PersonalLinkCard";

describe("payment link QR dialog", () => {
  it("opens a labeled linen QR dialog and restores focus after backdrop dismissal", async () => {
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
    expect(dialog).toHaveClass(
      "theme-linen",
      "bg-brand-linen",
      "rounded-3xl",
      "sm:max-w-sm",
    );
    expect(dialog).toHaveAccessibleDescription(
      "Scan this code to open the payment link on another device.",
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "size-10",
      "rounded-full",
    );
    expect(dialog.querySelector('path[fill="#1A1F12"]')).toBeInTheDocument();
    expect(dialog.querySelector('path[fill="#F5F3EA"]')).toBeInTheDocument();
    expect(dialog.querySelector(".bg-brand-linen")).toHaveClass(
      "bg-brand-linen",
      "p-4",
      "rounded-xl",
    );
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toHaveClass("bg-brand-obsidian/60");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(overlay as Element);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("uses a QR pair with at least 15:1 contrast", () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5]
        .map(
          (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
        )
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        );
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast =
      (luminance("#F5F3EA") + 0.05) / (luminance("#1A1F12") + 0.05);

    expect(contrast).toBeCloseTo(15.13, 2);
    expect(contrast).toBeGreaterThan(15);
  });
});
