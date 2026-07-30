// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalLinkCard } from "../src/components/dashboard/PersonalLinkCard";

describe("payment link share dialog", () => {
  it("shows the payment URL, QR code, and social share actions", async () => {
    const user = userEvent.setup();
    const payLink = "https://olio.example/pay/olio";
    render(<PersonalLinkCard username="olio" payLink={payLink} />);

    const trigger = screen.getByRole("button", {
      name: "Share personal payment link",
    });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Share payment link",
    });
    expect(dialog).toHaveTextContent("olio.example/pay/olio");
    expect(dialog.querySelector('path[fill="#20261a"]')).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Share on Facebook" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(payLink)),
    );
    expect(
      screen.getByRole("link", { name: "Share on X" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Share on WhatsApp" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Share on Telegram" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Share on LinkedIn" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
