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
      "rounded-xl",
      "bg-white/15",
      "text-white",
      "ring-1",
      "ring-white/25",
      "backdrop-blur-xl",
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
      "border-white/20",
      "bg-white/10",
      "text-white",
    );
    expect(screen.getByLabelText("Amount").parentElement).toHaveClass(
      "rounded-2xl",
      "bg-white/8",
      "ring-white/15",
      "backdrop-blur-xl",
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
