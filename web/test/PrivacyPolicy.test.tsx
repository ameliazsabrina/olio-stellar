// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({ alt = "" }: { alt?: string }) => (
    <span role="img" aria-label={alt} />
  ),
}));

import PrivacyPolicyPage from "../src/app/privacy/page";

describe("PrivacyPolicyPage", () => {
  it("renders the complete policy and links to it from the footer", () => {
    render(<PrivacyPolicyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(21);
    expect(
      screen.getByRole("heading", { level: 2, name: "Who we are" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Changes and contact" }),
    ).toBeInTheDocument();

    const footerPrivacyLink = screen.getByRole("link", { name: "Privacy Policy" });
    expect(footerPrivacyLink).toHaveAttribute("href", "/privacy");
    expect(footerPrivacyLink).not.toHaveAttribute("target");
    expect(
      screen.getByRole("link", { name: "Contact the privacy team" }),
    ).toHaveAttribute("href", "mailto:olio@oliopay.xyz");
  });
});
