// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Button } from "../src/components/ui/button";
import { Card } from "../src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../src/components/ui/dialog";
import { Input } from "../src/components/ui/input";

describe("glass primitives", () => {
  it("uses the canonical product button treatment", () => {
    render(<Button variant="glass">Continue</Button>);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveClass(
      "rounded-lg",
      "surface-glass-control",
      "theme-glass",
      "text-white",
      "hover:bg-white/20",
      "hover:text-white",
      "focus-visible:ring-white/70",
    );
  });

  it("keeps glass panels and fields on the same translucent system", () => {
    render(
      <Card appearance="glass">
        <Input appearance="glass" aria-label="Amount" />
      </Card>,
    );

    expect(screen.getByLabelText("Amount")).toHaveClass(
      "surface-glass-field",
      "theme-glass",
      "text-white",
    );
    expect(screen.getByLabelText("Amount").parentElement).toHaveClass(
      "rounded-2xl",
      "surface-glass-panel",
      "theme-glass",
    );
  });

  it("exposes explicit card density and dialog width roles", () => {
    render(
      <>
        <Card density="comfortable">Summary</Card>
        <Dialog open>
          <DialogContent size="lg">
            <DialogTitle>Large dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    );

    expect(screen.getByText("Summary")).toHaveAttribute(
      "data-density",
      "comfortable",
    );
    expect(screen.getByRole("dialog", { name: "Large dialog" })).toHaveClass(
      "sm:max-w-xl",
    );
  });

  it("keeps dialogs inset from and scrollable within the mobile viewport", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Responsive dialog</DialogTitle>
          <div>Content</div>
        </DialogContent>
      </Dialog>,
    );

    expect(
      screen.getByRole("dialog", { name: "Responsive dialog" }),
    ).toHaveClass(
      "max-h-[calc(100dvh-2rem)]",
      "max-w-[calc(100%-2rem)]",
      "overflow-x-hidden",
      "overflow-y-auto",
      "overscroll-contain",
    );
  });
});
