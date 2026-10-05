// @vitest-environment happy-dom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../src/trpc/client", () => ({
  api: { aiDrafts: { generate: { mutate: generate } } },
}));
import { AiLinkDraft } from "../src/components/dashboard/AiLinkDraft";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("requires explicit apply before changing the form", async () => {
  const draft = {
    description: "design",
    amount: "50",
    warning: "Review this draft",
  };
  generate.mockResolvedValue(draft);
  const apply = vi.fn();
  render(<AiLinkDraft onApply={apply} />);
  fireEvent.click(screen.getByText("Draft with AI · Preview"));
  fireEvent.change(
    screen.getByLabelText("What are you requesting payment for?"),
    { target: { value: "50 USDC for design" } },
  );
  fireEvent.click(screen.getByText("Generate draft"));
  await screen.findByText("Use draft in form");
  expect(apply).not.toHaveBeenCalled();
  expect(generate).toHaveBeenCalledWith({ text: "50 USDC for design" });
  fireEvent.click(screen.getByText("Use draft in form"));
  expect(apply).toHaveBeenCalledWith(draft);
});
it("shows a recoverable error without applying anything", async () => {
  generate.mockRejectedValue(new Error("offline"));
  const apply = vi.fn();
  render(<AiLinkDraft onApply={apply} />);
  fireEvent.click(screen.getByText("Draft with AI · Preview"));
  fireEvent.change(
    screen.getByLabelText("What are you requesting payment for?"),
    { target: { value: "50 USDC" } },
  );
  fireEvent.click(screen.getByText("Generate draft"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("unavailable"),
  );
  expect(apply).not.toHaveBeenCalled();
});
