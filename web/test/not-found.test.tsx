// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string | { src: string }; alt: string }) => (
    <div
      data-testid="next-image"
      data-alt={alt}
      data-src={typeof src === "string" ? src : src.src}
    />
  ),
}));

import NotFound from "../src/app/not-found";

describe("NotFound", () => {
  it("explains the missing page and offers recovery links", () => {
    const { container } = render(<NotFound />);

    expect(
      screen.getByRole("heading", {
        name: "Page not found.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/check the address or head back/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Olio home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("link", { name: "Open dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(container.querySelector("#dashboard-content")).toHaveClass(
      "max-w-7xl",
    );
  });
});
