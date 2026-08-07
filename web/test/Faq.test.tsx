// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Faq } from "@/components/landing/Faq";

describe("Faq", () => {
  it("exposes an answer to assistive technology only while expanded", async () => {
    const user = userEvent.setup();
    render(<Faq />);

    const question = screen.getByRole("button", {
      name: "Do my clients need to use Olio?",
    });
    const answerId = question.getAttribute("aria-controls");

    expect(answerId).toBeTruthy();
    const answer = document.getElementById(answerId as string);
    expect(answer).not.toBeNull();
    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(answer).toHaveAttribute("aria-hidden", "true");

    await user.click(question);

    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(answer).toHaveAttribute("aria-hidden", "false");

    await user.click(question);

    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(answer).toHaveAttribute("aria-hidden", "true");
  });
});
