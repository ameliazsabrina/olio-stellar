// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { StickyBanner } from "../src/components/ui/sticky-banner";

it("dismisses the announcement without relying on scroll state", async () => {
  render(
    <StickyBanner hideOnScroll={false} data-announcement-banner>
      Service announcement
    </StickyBanner>,
  );

  expect(screen.getByText("Service announcement")).toHaveAttribute(
    "data-state",
    "open",
  );

  await userEvent.click(
    screen.getByRole("button", { name: "Dismiss announcement" }),
  );

  await waitFor(() => {
    expect(
      screen.queryByText("Service announcement"),
    ).not.toBeInTheDocument();
  });
});
