// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PinDialog } from "../src/components/PinDialog";
import { Toaster } from "../src/components/ui/sonner";

function setup(props: Partial<React.ComponentProps<typeof PinDialog>> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
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
  return { onSubmit, onClose };
}

describe("PinDialog — unlock mode", () => {
  it("submits a valid 6-digit PIN", async () => {
    const { onSubmit } = setup({ mode: "unlock" });
    await userEvent.type(screen.getByLabelText("PIN"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(onSubmit).toHaveBeenCalledWith("123456");
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
    setup({ mode: "unlock", error: "Incorrect PIN. Try again." });
    expect(
      await screen.findByText("Incorrect PIN. Try again."),
    ).toBeInTheDocument();
  });
});

describe("PinDialog — set mode", () => {
  it("requires the confirmation to match before submitting", async () => {
    const { onSubmit } = setup({ mode: "set" });
    await userEvent.type(screen.getByLabelText("New PIN"), "123456");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "654321");
    await userEvent.click(screen.getByRole("button", { name: /set pin/i }));
    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
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
    expect(screen.getByRole("note")).toHaveTextContent(/invisible here/i);
    await userEvent.type(screen.getByLabelText("New PIN"), "112233");
    await userEvent.type(screen.getByLabelText("Confirm PIN"), "112233");
    await userEvent.click(
      screen.getByRole("button", { name: /secure account/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith("112233");
  });
});
