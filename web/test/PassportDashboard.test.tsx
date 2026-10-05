// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: null as null | Record<string, unknown>,
  identityLoading: false,
  setVisibility: vi.fn(),
  setVisibilityPending: false,
  status: null as null | Record<string, unknown>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  setData: vi.fn(),
}));

vi.mock("../src/features/verification/useVerification", () => ({
  useVerification: () => ({
    business: { businessId: "biz_1", type: "individual" },
    businessesLoading: false,
    status: mocks.status,
  }),
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      passport: { identity: { setData: mocks.setData } },
    }),
    passport: {
      identity: {
        useQuery: () => ({
          data: mocks.preview,
          isLoading: mocks.identityLoading,
        }),
      },
      setVisibility: {
        useMutation: () => ({
          mutateAsync: mocks.setVisibility,
          isPending: mocks.setVisibilityPending,
        }),
      },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import {
  badgeStateFor,
  PassportDashboard,
} from "../src/components/dashboard/PassportDashboard";

function credential(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    issuer: "olio",
    policyVersion: 1,
    checkedAt: "2026-09-21T10:00:00.000Z",
    validUntil: "2027-09-21T10:00:00.000Z",
    published: false,
    environment: "sandbox",
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    businessId: "biz_1",
    publicId: "pub_abcdef",
    displayName: "Alice",
    type: "individual",
    credential: credential(),
    publishable: true,
    publicPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = preview();
  mocks.identityLoading = false;
  mocks.setVisibilityPending = false;
  mocks.status = { eligibility: "approved" };
  mocks.setVisibility.mockResolvedValue(preview());
});

describe("badge state mapping", () => {
  it("maps credential status to the badge state", () => {
    expect(badgeStateFor(null)).toBe("none");
    expect(badgeStateFor(undefined)).toBe("none");
    expect(badgeStateFor({ status: "active" })).toBe("verified");
    expect(badgeStateFor({ status: "suspended" })).toBe("suspended");
    expect(badgeStateFor({ status: "expired" })).toBe("expired");
  });
});

describe("private preview", () => {
  it("shows the verified badge with issuer, scope and dates", () => {
    render(<PassportDashboard />);
    const badge = screen.getByTestId("identity-badge");
    expect(badge).toHaveAttribute("data-state", "verified");
    expect(badge).toHaveTextContent("Identity Verified");
    expect(badge).toHaveTextContent("Olio");
    expect(badge).toHaveTextContent("Identity only");
  });

  it("states the badge is private until published", () => {
    render(<PassportDashboard />);
    expect(screen.getByText(/Your badge is private/)).toBeInTheDocument();
    expect(screen.queryByTestId("public-identity-url")).not.toBeInTheDocument();
  });

  it("shows a suspended credential rather than a verified one", () => {
    mocks.preview = preview({
      credential: credential({ status: "suspended" }),
      publishable: false,
    });
    render(<PassportDashboard />);
    expect(screen.getByTestId("identity-badge")).toHaveAttribute(
      "data-state",
      "suspended",
    );
    expect(
      screen.getByRole("button", { name: /Publish badge/ }),
    ).toBeDisabled();
  });

  it("shows an expired credential as expired", () => {
    mocks.preview = preview({
      credential: credential({ status: "expired" }),
      publishable: false,
    });
    render(<PassportDashboard />);
    expect(screen.getByTestId("identity-badge")).toHaveAttribute(
      "data-state",
      "expired",
    );
    expect(
      screen.getByText(/Publishing unlocks once verification is approved/),
    ).toBeInTheDocument();
  });

  it("points an unverified user back to verification", () => {
    mocks.preview = preview({ credential: null, publishable: false });
    mocks.status = { eligibility: "pending" };
    render(<PassportDashboard />);
    expect(screen.getByTestId("identity-badge")).toHaveAttribute(
      "data-state",
      "none",
    );
    expect(
      screen.getByRole("link", { name: "Go to verification" }),
    ).toHaveAttribute("href", "/verification");
  });

  it("announces the loading state", () => {
    mocks.identityLoading = true;
    render(<PassportDashboard />);
    expect(
      screen.getByRole("status", { name: "Loading passport" }),
    ).toBeInTheDocument();
  });
});

describe("publication consent", () => {
  it("publishes only on an explicit action", async () => {
    render(<PassportDashboard />);
    expect(mocks.setVisibility).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: /Publish badge/ }),
    );
    await waitFor(() =>
      expect(mocks.setVisibility).toHaveBeenCalledWith({
        businessId: "biz_1",
        published: true,
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Badge published");
  });

  it("shows the shareable link and offers to hide the badge once published", async () => {
    mocks.preview = preview({
      credential: credential({ published: true }),
      publicPath: "/business/pub_abcdef",
    });
    render(<PassportDashboard />);
    expect(screen.getByTestId("public-identity-url")).toHaveTextContent(
      "/business/pub_abcdef",
    );
    const toggle = screen.getByRole("button", { name: /Hide badge/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.setVisibility).toHaveBeenCalledWith({
        businessId: "biz_1",
        published: false,
      }),
    );
  });

  it("refuses to publish an unpublishable credential from the client", () => {
    mocks.preview = preview({ publishable: false });
    render(<PassportDashboard />);
    expect(
      screen.getByRole("button", { name: /Publish badge/ }),
    ).toBeDisabled();
  });

  it("surfaces a server refusal as a readable message", async () => {
    mocks.setVisibility.mockRejectedValue(
      new Error(
        "Your identity badge can be published once verification is approved.",
      ),
    );
    render(<PassportDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: /Publish badge/ }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Your identity badge can be published once verification is approved.",
      ),
    );
  });

  it("gives the copy control an accessible name", () => {
    mocks.preview = preview({
      credential: credential({ published: true }),
      publicPath: "/business/pub_abcdef",
    });
    render(<PassportDashboard />);
    expect(
      screen.getByRole("button", { name: "Copy public link" }),
    ).toBeInTheDocument();
  });
});

describe("scope disclosure", () => {
  it("states what the badge does and does not cover", () => {
    render(<PassportDashboard />);
    const scope = screen.getByRole("region", { name: "What this badge means" });
    expect(scope).toHaveTextContent(/identity documents and checks passed/i);
    expect(scope).toHaveTextContent(/revenue/i);
    expect(scope).toHaveTextContent(/creditworthiness/i);
  });
});
