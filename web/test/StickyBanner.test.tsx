// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { StickyBanner } from "../src/components/ui/sticky-banner";

it("dismisses the announcement without relying on scroll state", async () => {
  render(
    <StickyBanner hideOnScroll={false} data-moneygram-banner>
      MoneyGram integration status
    </StickyBanner>,
  );

  expect(screen.getByText("MoneyGram integration status")).toHaveAttribute(
    "data-state",
    "open",
  );

  await userEvent.click(
    screen.getByRole("button", { name: "Dismiss announcement" }),
  );

  await waitFor(() => {
    expect(
      screen.queryByText("MoneyGram integration status"),
    ).not.toBeInTheDocument();
  });
});
