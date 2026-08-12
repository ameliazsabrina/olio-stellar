// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { DashboardTile } from "../src/components/dashboard/DashboardTile";

describe("DashboardTile", () => {
  it("keeps its role-specific footer in the bottom slot", () => {
    render(
      <DashboardTile
        appearance="linen"
        header={<h2>Header</h2>}
        content={<p>Variable content</p>}
        footer={<span>Bottom action</span>}
      />,
    );

    const footer = screen.getByText("Bottom action").parentElement;
    expect(footer).toHaveAttribute("data-slot", "tile-footer");
    expect(footer).toHaveClass("mt-auto");
  });
});
