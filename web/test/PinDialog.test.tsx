// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PinDialog } from "../src/components/PinDialog";
import { Toaster } from "../src/components/ui/sonner";

function setup(props: Partial<React.ComponentProps<typeof PinDialog>> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <>
      <PinDialog
        open
        mode="unlock"
        submitting={false}
        error=""
        onSubmit={onSubmit}
        onClose={onClose}
        {...props}
      />
      <Toaster />
    </>,
  );
  return { onSubmit, onClose, ...view };
}

describe("PinDialog — unlock mode", () => {
  it("is labeled by its title and description", () => {
    setup();

    expect(
      screen.getByRole("dialog", { name: "Unlock your account" }),
    ).toHaveAccessibleDescription(
      "Enter your 6-digit PIN to restore your account key on this device and reveal your balance.",
    );
  });

  it("shows the loader before the pending label", () => {
    setup({ submitting: true });

    const button = screen.getByRole("button", { name: "Working…" });
    expect(button.firstElementChild).toHaveClass(
      "lucide-loader",
      "motion-safe:animate-spin",
    );
  });

  it("submits a valid 6-digit PIN", async () => {
    const { onSubmit } = setup({ mode: "unlock" });
    await userEvent.type(screen.getByLabelText("PIN"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("keeps a well-formed PIN neutral until escrow authentication", async () => {
    setup({ mode: "unlock" });
    const input = screen.getByLabelText("PIN");
    await userEvent.type(input, "123456");
    await userEvent.tab();
    expect(input).not.toHaveClass("border-emerald-600");
    expect(input).not.toHaveClass("border-destructive");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("rejects a short PIN with a local error and does not submit", async () => {
    const { onSubmit } = setup({ mode: "unlock" });
    await userEvent.type(screen.getByLabelText("PIN"), "123");
    await userEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(await screen.findByText(/exactly 6 digits/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("strips non-digit characters from input", async () => {
    const { onSubmit } = setup({ mode: "unlock" });
    await userEvent.type(screen.getByLabelText("PIN"), "12ab34cd56");
    await userEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("surfaces a server-provided error (e.g. wrong PIN)", async () => {
    const { onSubmit, onClose, rerender } = setup({ mode: "unlock" });
    const input = screen.getByLabelText("PIN");
    await userEvent.type(input, "123456");
    rerender(
      <>
        <PinDialog
          open
          mode="unlock"
          submitting={false}
          error="Incorrect PIN. Try again."
          onSubmit={onSubmit}
          onClose={onClose}
        />
        <Toaster />
      </>,
    );
    expect(
      await screen.findByText("Incorrect PIN. Try again."),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(input).toHaveClass("border-destructive");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

describe("PinDialog — set mode", () => {
  it("keeps mandatory setup open when Escape requests dismissal", async () => {
    const { onClose } = setup({ mode: "set" });

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Set Your Recovery PIN" }),
    ).toBeInTheDocument();
  });

  it("requires the confirmation to match before submitting", async () => {
    const { onSubmit } = setup({ mode: "set" });
    await userEvent.type(screen.getByLabelText("New PIN"), "123456");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "654321");
    await userEvent.click(screen.getByRole("button", { name: /set pin/i }));
    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm PIN")).toHaveClass(
      "border-destructive",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when both PINs match", async () => {
    const { onSubmit } = setup({ mode: "set" });
    await userEvent.type(screen.getByLabelText("New PIN"), "246810");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "246810");
    await userEvent.click(screen.getByRole("button", { name: /set pin/i }));
    expect(onSubmit).toHaveBeenCalledWith("246810");
  });
});

describe("PinDialog — secure (re-key) mode", () => {
  it("warns about old funds and re-keys with a confirmed PIN", async () => {
    const { onSubmit } = setup({ mode: "secure" });
    expect(screen.getByText(/cash out old payments/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New PIN"), "112233");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "112233");
    await userEvent.click(
      screen.getByRole("button", { name: /secure account/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith("112233");
  });
});
