// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { ProblemStatement } from "../src/components/landing/ProblemStatement";

const gsapMock = vi.hoisted(() => ({
  context: vi.fn((callback: () => void) => {
    callback();
    return { revert: vi.fn() };
  }),
  fromTo: vi.fn(),
  matchMedia: vi.fn(() => ({
    add: vi.fn((_query: unknown, callback: (context: unknown) => void) => {
      callback({ conditions: { reduceMotion: false } });
    }),
    revert: vi.fn(),
  })),
  registerPlugin: vi.fn(),
  set: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: gsapMock,
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: { refresh: vi.fn() },
}));

describe("ProblemStatement scroll reveal", () => {
  it("splits nested statement text into animated word spans", () => {
    const { container } = render(<ProblemStatement />);

    expect(
      screen.getByText(/can see what everyone else pays you/i),
    ).toBeInTheDocument();
    expect(screen.getByText("revenue,")).toHaveClass("word");
    expect(screen.getByText("consolidated.")).toHaveClass("word");
    expect(screen.getByText("revenue,").parentElement).toHaveClass(
      "font-bold",
      "text-olive-deep",
    );
    expect(container.querySelectorAll(".word").length).toBeGreaterThan(30);
    expect(gsapMock.fromTo).toHaveBeenCalled();
  });
});
