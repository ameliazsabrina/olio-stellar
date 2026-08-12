// @vitest-environment happy-dom
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    className?: string;
  }) => (
    <div
      data-testid="next-image"
      data-alt={props.alt}
      data-sizes={props.sizes}
      data-src={typeof src === "string" ? src : src.src}
      data-priority={priority ? "true" : "false"}
      data-placeholder={placeholder}
      data-fill={fill ? "true" : "false"}
      className={props.className}
    />
  ),
}));

import {
  DashboardBackground,
  useDashboardTheme,
} from "../src/components/dashboard/DashboardBackground";

function ThemeControl() {
  const { theme, toggleTheme } = useDashboardTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

describe("DashboardBackground", () => {
  beforeEach(() => window.localStorage.clear());

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
    expect(image).toHaveClass("object-cover", "object-center");
    expect(image).not.toHaveClass("grayscale", "contrast-110");
    expect(container.firstElementChild).toHaveClass(
      "theme-product",
      "bg-brand-obsidian",
      "text-white",
    );
    expect(container.firstElementChild).toHaveAttribute(
      "data-dashboard-theme",
      "painting",
    );
    expect(
      container.querySelector('[class*="radial-gradient"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".mix-blend-multiply"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("keeps the dashboard source image below 100 KB", () => {
    const asset = resolve("src/assets/dashboard-background.webp");

    expect(statSync(asset).size).toBeLessThan(100 * 1024);
  });

  it("keeps the painting visible under a darker overlay in dark mode", async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    const { container } = render(
      <DashboardBackground>
        <ThemeControl />
      </DashboardBackground>,
    );

    await user.click(screen.getByRole("button", { name: "painting" }));
    expect(container.firstElementChild).toHaveAttribute(
      "data-dashboard-theme",
      "dark",
    );
    expect(container.querySelector('[data-testid="next-image"]')).toHaveClass(
      "object-cover",
      "object-center",
    );
    expect(
      container.querySelector('[data-testid="next-image"]'),
    ).not.toHaveClass("opacity-0");
    expect(
      container.querySelector(".bg-brand-obsidian.opacity-75"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("olio.dashboard.theme")).toBe("dark");

    const { container: restored } = render(
      <DashboardBackground>
        <p>Restored</p>
      </DashboardBackground>,
    );
    await waitFor(() =>
      expect(restored.firstElementChild).toHaveAttribute(
        "data-dashboard-theme",
        "dark",
      ),
    );
  });

  it("defines a dark surface override for linen dashboard cards", () => {
    const css = readFileSync(resolve("src/app/globals.css"), "utf8");
    const componentsLayerStart = css.indexOf("@layer components");
    const darkThemeStart = css.indexOf(
      '[data-dashboard-theme="dark"] .theme-linen',
    );
    const darkSurfaceStart = css.indexOf(
      '[data-dashboard-theme="dark"] .surface-linen-panel',
    );

    expect(darkThemeStart).toBeGreaterThan(-1);
    expect(darkSurfaceStart).toBeGreaterThan(-1);
    expect(darkThemeStart).toBeGreaterThan(componentsLayerStart);
    expect(darkSurfaceStart).toBeGreaterThan(componentsLayerStart);
    expect(css).toContain("background: var(--color-brand-obsidian-secondary);");
  });
});
