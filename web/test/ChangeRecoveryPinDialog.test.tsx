// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ChangeRecoveryPinDialog } from "../src/components/dashboard/ChangeRecoveryPinDialog";
import { BadPinError } from "../src/lib/pin-errors";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

function Harness({
  submit = vi.fn().mockResolvedValue(undefined),
  validateCurrentPin = vi.fn().mockResolvedValue(true),
}: {
  submit?: (currentPin: string, newPin: string) => Promise<void>;
  validateCurrentPin?: (currentPin: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ChangeRecoveryPinDialog
        open={open}
        onOpenChange={setOpen}
        isChanging={pending}
        onValidateCurrentPin={validateCurrentPin}
        onSubmit={async (...pins) => {
          setPending(true);
          try {
            await submit(...pins);
          } finally {
            setPending(false);
          }
        }}
      />
    </>
  );
}

async function enterPins(
  current = "123456",
  next = "654321",
  confirmation = next,
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current PIN"), current);
  await user.type(screen.getByLabelText("New PIN"), next);
  await user.type(screen.getByLabelText("Confirm new PIN"), confirmation);
  return user;
}

describe("ChangeRecoveryPinDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has an accessible title, description, and labelled numeric PIN fields", () => {
    render(<Harness />);
    expect(
      screen.getByRole("dialog", { name: "Change recovery PIN" }),
    ).toHaveAccessibleDescription();
    for (const label of ["Current PIN", "New PIN", "Confirm new PIN"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute(
        "inputmode",
        "numeric",
      );
    }
  });

  it("filters non-digits and validates length, matching, and changed PIN", async () => {
    render(<Harness />);
    const current = screen.getByLabelText("Current PIN");
    await userEvent.type(current, "12a34b56x7");
    expect(current).toHaveValue("123456");

    await userEvent.type(screen.getByLabelText("New PIN"), "654321");
    await userEvent.type(screen.getByLabelText("Confirm new PIN"), "654320");
    await userEvent.click(screen.getByRole("button", { name: "Change PIN" }));
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "The new PINs don't match.",
      { id: "change-recovery-pin-error" },
    );
    expect(screen.getByLabelText("Confirm new PIN")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await userEvent.clear(screen.getByLabelText("New PIN"));
    await userEvent.type(screen.getByLabelText("New PIN"), "123456");
    await userEvent.clear(screen.getByLabelText("Confirm new PIN"));
    await userEvent.type(screen.getByLabelText("Confirm new PIN"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Change PIN" }));
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "Choose a new PIN that differs from your current PIN.",
      { id: "change-recovery-pin-error" },
    );
    expect(screen.getByLabelText("New PIN")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("checks the current PIN locally on blur and colors only that input", async () => {
    const validateCurrentPin = vi.fn().mockResolvedValue(false);
    render(<Harness validateCurrentPin={validateCurrentPin} />);
    const current = screen.getByLabelText("Current PIN");
    await userEvent.type(current, "123456");
    await userEvent.tab();

    await waitFor(() =>
      expect(validateCurrentPin).toHaveBeenCalledWith("123456"),
    );
    await waitFor(() =>
      expect(current).toHaveAttribute("aria-invalid", "true"),
    );
    expect(current).toHaveClass("border-destructive");
    expect(screen.getByLabelText("New PIN")).not.toHaveAttribute(
      "aria-invalid",
    );
    expect(mocks.toastError).toHaveBeenCalledWith("Current PIN is incorrect", {
      id: "change-recovery-pin-error",
    });
  });

  it("prevents duplicate submission, disables dismissal, and closes after success", async () => {
    let resolve: (() => void) | undefined;
    const submit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<Harness submit={submit} />);
    const user = await enterPins();
    const button = screen.getByRole("button", { name: "Change PIN" });
    await user.dblClick(button);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", { name: "Changing…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    resolve?.();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("reports an incorrect current PIN and clears sensitive state after close", async () => {
    const submit = vi.fn().mockRejectedValue(new BadPinError());
    render(<Harness submit={submit} />);
    const user = await enterPins();
    await user.click(screen.getByRole("button", { name: "Change PIN" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Current PIN is incorrect",
        { id: "change-recovery-pin-error" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Current PIN")).toHaveValue(""),
    );
    expect(screen.getByLabelText("New PIN")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new PIN")).toHaveValue("");
  });
});
