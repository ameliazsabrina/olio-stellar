// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Button } from "../src/components/ui/button";
import { Card } from "../src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../src/components/ui/dialog";
import { Input } from "../src/components/ui/input";

describe("glass primitives", () => {
  it("uses the canonical product button treatment", () => {
    render(<Button variant="glass">Continue</Button>);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveClass(
      "rounded-full",
      "surface-glass-control",
      "theme-glass",
      "text-white",
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
      "rounded-full",
      "text-white",
    );
    expect(screen.getByLabelText("Amount").parentElement).toHaveClass(
      "rounded-[1.5rem]",
      "surface-glass-panel",
      "theme-glass",
    );
  });

  it("provides an Obsidian-on-Linen semantic card surface", () => {
    render(<Card appearance="linen">Linen summary</Card>);

    expect(screen.getByText("Linen summary")).toHaveClass(
      "surface-linen-panel",
      "theme-linen",
      "text-foreground",
      "ring-border",
    );
    expect(screen.getByText("Linen summary")).not.toHaveClass(
      "!bg-brand-linen",
    );
  });

  it("exposes explicit card density and dialog width roles", () => {
    render(
      <>
        <Card density="comfortable">Summary</Card>
        <Dialog open>
          <DialogContent appearance="glass" size="lg">
            <DialogTitle>Large dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    );

    expect(screen.getByText("Summary")).toHaveAttribute(
      "data-density",
      "comfortable",
    );
    const dialog = screen.getByRole("dialog", { name: "Large dialog" });
    expect(dialog).toHaveClass(
      "rounded-3xl",
      "surface-glass-popover",
      "sm:max-w-xl",
      "data-open:duration-300",
      "data-closed:duration-200",
      "motion-reduce:duration-0",
    );
    expect(dialog).toHaveAttribute("data-appearance", "glass");
    expect(dialog).toHaveAttribute("data-size", "lg");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "size-10",
      "rounded-full",
      "surface-glass-control",
      "theme-glass",
    );
  });

  it("keeps dialogs inset from and scrollable within the mobile viewport", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Responsive dialog</DialogTitle>
            <DialogDescription>Contained dialog content.</DialogDescription>
          </DialogHeader>
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
      "p-5",
      "sm:p-6",
    );
    expect(
      screen.getByRole("dialog", { name: "Responsive dialog" }),
    ).toHaveAccessibleDescription("Contained dialog content.");
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "bg-brand-obsidian/60",
      "data-open:duration-300",
      "data-closed:duration-200",
      "motion-reduce:duration-0",
    );
  });
});
