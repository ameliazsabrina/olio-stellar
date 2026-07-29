// @vitest-environment happy-dom
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({
    priority,
    placeholder,
    fill,
    src,
    ...props
  }: {
    priority?: boolean;
    placeholder?: string;
    fill?: boolean;
    src: string | { src: string };
    alt: string;
    sizes?: string;
  }) => (
    <div
      data-testid="next-image"
      data-alt={props.alt}
      data-sizes={props.sizes}
      data-src={typeof src === "string" ? src : src.src}
      data-priority={priority ? "true" : "false"}
      data-placeholder={placeholder}
      data-fill={fill ? "true" : "false"}
    />
  ),
}));

import { DashboardBackground } from "../src/components/dashboard/DashboardBackground";

describe("DashboardBackground", () => {
  it("uses a prioritized decorative image behind dashboard content", () => {
    const { container } = render(
      <DashboardBackground>
        <p>Dashboard content</p>
      </DashboardBackground>,
    );

    const image = container.querySelector('[data-testid="next-image"]');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("data-alt", "");
    expect(image).toHaveAttribute("data-sizes", "100vw");
    expect(image).toHaveAttribute("data-priority", "true");
    expect(image).toHaveAttribute("data-placeholder", "blur");
    expect(image).toHaveAttribute("data-fill", "true");
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("keeps the dashboard source image below 100 KB", () => {
    const asset = resolve("src/assets/dashboard-background.webp");

    expect(statSync(asset).size).toBeLessThan(100 * 1024);
  });
});
