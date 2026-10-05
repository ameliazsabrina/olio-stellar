// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Eligibility =
  | "not_started"
  | "pending"
  | "needs_information"
  | "manual_review"
  | "approved"
  | "declined";

const mocks = vi.hoisted(() => ({
  business: null as null | {
    businessId: string;
    publicId: string;
    type: "individual" | "company";
    lifecycle: string;
    displayName: string | null;
    username: string | null;
    accountBound: boolean;
    role: string;
    createdAt: string;
    updatedAt: string;
  },
  status: null as null | Record<string, unknown>,
  businessesLoading: false,
  statusLoading: false,
  polling: false,
  createBusiness: vi.fn(),
  bindAccount: vi.fn(),
  start: vi.fn(),
  requestRefresh: vi.fn(),
  requestToken: vi.fn(),
  markSubmitted: vi.fn(),
  startPending: false,
  refreshPending: false,
  sdkProps: null as null | Record<string, unknown>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  version: 0,
  listeners: new Set<() => void>(),
}));

vi.mock("../src/features/verification/useVerification", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useVerification: () => {
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener);
          return () => mocks.listeners.delete(listener);
        },
        () => mocks.version,
        () => mocks.version,
      );
      return storeSnapshot();
    },
  };
});

function storeSnapshot() {
  return {
    business: mocks.business,
    businessId: mocks.business?.businessId ?? null,
    businessesLoading: mocks.businessesLoading,
    businessesError: null,
    status: mocks.status,
    statusLoading: mocks.statusLoading,
    statusError: null,
    polling: mocks.polling,
    createBusiness: { mutateAsync: mocks.createBusiness, isPending: false },
    bindAccount: { mutateAsync: mocks.bindAccount, isPending: false },
    start: { mutateAsync: mocks.start, isPending: mocks.startPending },
    refresh: { mutateAsync: vi.fn(), isPending: mocks.refreshPending },
    sdkToken: { mutateAsync: vi.fn(), isPending: false },
    requestToken: mocks.requestToken,
    requestRefresh: mocks.requestRefresh,
    markSubmitted: mocks.markSubmitted,
    reload: vi.fn(),
  };
}

function publish(next: Record<string, unknown>) {
  mocks.status = next;
  mocks.version += 1;
  for (const listener of mocks.listeners) listener();
}
vi.mock("../src/features/verification/SumsubVerification", () => ({
  SumsubVerification: (props: Record<string, unknown>) => {
    mocks.sdkProps = props;
    return <div data-testid="sumsub-sdk-frame">provider frame</div>;
  },
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { VerificationDashboard } from "../src/components/dashboard/VerificationDashboard";

function status(overrides: Record<string, unknown> = {}) {
  return {
    businessId: "biz_1",
    type: "individual" as const,
    environment: "sandbox",
    mode: "sandbox",
    eligibility: "not_started" as Eligibility,
    providerStage: "not_started",
    userMessage: null,
    nextAction: "start",
    checkedAt: null,
    lastEventAt: null,
    policyVersion: 1,
    credential: null,
    canStart: true,
    ...overrides,
  };
}

const business = {
  businessId: "biz_1",
  publicId: "pub_1",
  type: "individual" as const,
  lifecycle: "active",
  displayName: "Alice",
  username: "alice",
  accountBound: true,
  role: "owner",
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.business = { ...business };
  mocks.status = status();
  mocks.businessesLoading = false;
  mocks.statusLoading = false;
  mocks.polling = false;
  mocks.startPending = false;
  mocks.refreshPending = false;
  mocks.sdkProps = null;
  mocks.listeners.clear();
  mocks.start.mockImplementation(async () => {
    const next = status({ nextAction: "continue" });
    publish(next);
    return next;
  });
  mocks.requestRefresh.mockResolvedValue(undefined);
  mocks.createBusiness.mockResolvedValue(business);
  mocks.bindAccount.mockResolvedValue({ business, changed: true });
});

describe("profile creation", () => {
  it("offers the individual and company choice when no profile exists", async () => {
    mocks.business = null;
    mocks.status = null;
    render(<VerificationDashboard />);
    expect(
      screen.getByRole("heading", { name: "Who is being verified?" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Company/ }));
    await userEvent.type(
      screen.getByLabelText("Display name (optional)"),
      "Kopi Co",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create profile" }),
    );
    await waitFor(() =>
      expect(mocks.createBusiness).toHaveBeenCalledWith({
        type: "company",
        displayName: "Kopi Co",
      }),
    );
  });

  it("invites linking the Olio account when the profile is unbound", async () => {
    mocks.business = { ...business, accountBound: false, username: null };
    mocks.status = status({ canStart: false, nextAction: "start" });
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Link my account" }),
    );
    await waitFor(() =>
      expect(mocks.bindAccount).toHaveBeenCalledWith({ businessId: "biz_1" }),
    );
    expect(
      screen.getByText("Link your Olio account to start."),
    ).toBeInTheDocument();
  });
});

describe("state rendering", () => {
  const cases: [Eligibility, string, string][] = [
    ["pending", "In review", "Your details are being checked"],
    ["needs_information", "Action needed", "One more step is needed"],
    ["manual_review", "Under review", "A reviewer is taking a look"],
    ["approved", "Verified", "Your identity is verified"],
    ["declined", "Not approved", "Verification was not approved"],
  ];

  it.each(
    cases,
  )("renders the %s state with its badge and headline", (eligibility, badge, headline) => {
    mocks.status = status({
      eligibility,
      nextAction:
        eligibility === "approved"
          ? "done"
          : eligibility === "needs_information"
            ? "resubmit"
            : eligibility === "declined"
              ? "contact_support"
              : "wait",
      userMessage: "Server supplied message",
    });
    render(<VerificationDashboard />);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.getByTestId("status-headline")).toHaveTextContent(headline);
    expect(screen.getByTestId("status-message")).toHaveTextContent(
      "Server supplied message",
    );
  });

  it("shows the passport link once approved and offers no restart", () => {
    mocks.status = status({
      eligibility: "approved",
      nextAction: "done",
      canStart: false,
    });
    render(<VerificationDashboard />);
    expect(screen.getByRole("link", { name: "Open passport" })).toHaveAttribute(
      "href",
      "/passport",
    );
    expect(
      screen.queryByRole("button", { name: "Start verification" }),
    ).not.toBeInTheDocument();
  });

  it("offers support rather than a retry when declined", () => {
    mocks.status = status({
      eligibility: "declined",
      nextAction: "contact_support",
      canStart: false,
    });
    render(<VerificationDashboard />);
    expect(
      screen.queryByRole("button", { name: "Contact support" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Not approved")).toBeInTheDocument();
  });

  it("does not render the provider frame until a session is opened", () => {
    render(<VerificationDashboard />);
    expect(screen.queryByTestId("sumsub-sdk-frame")).not.toBeInTheDocument();
  });

  it("announces its loading states for assistive technology", () => {
    mocks.businessesLoading = true;
    render(<VerificationDashboard />);
    expect(
      screen.getByRole("status", { name: "Loading your business profile" }),
    ).toBeInTheDocument();
  });
});

describe("session flow", () => {
  it("opens the provider frame after the server confirms the applicant", async () => {
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Start verification" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("sumsub-sdk-frame")).toBeInTheDocument(),
    );
    expect(mocks.start).toHaveBeenCalledWith({ businessId: "biz_1" });
    expect(mocks.sdkProps?.getToken).toBe(mocks.requestToken);
  });

  it("keeps the frame closed when the server does not move the case forward", async () => {
    mocks.start.mockImplementation(async () => {
      const next = status({ nextAction: "wait" });
      publish(next);
      return next;
    });
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Start verification" }),
    );
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(screen.queryByTestId("sumsub-sdk-frame")).not.toBeInTheDocument();
  });

  it("surfaces a readable error when the session cannot be started", async () => {
    mocks.start.mockRejectedValue(
      new Error("Identity verification is not configured."),
    );
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Start verification" }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Identity verification is not configured.",
      ),
    );
    expect(screen.queryByTestId("sumsub-sdk-frame")).not.toBeInTheDocument();
  });

  it("treats an SDK submission as a refresh request, never as approval", async () => {
    mocks.status = status({
      eligibility: "not_started",
      nextAction: "continue",
    });
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Continue verification" }),
    );
    await waitFor(() => expect(mocks.sdkProps).not.toBeNull());
    (mocks.sdkProps?.onSubmitted as () => void)();
    expect(mocks.markSubmitted).toHaveBeenCalled();
    await waitFor(() => expect(mocks.requestRefresh).toHaveBeenCalled());
    expect(screen.getByTestId("status-headline")).not.toHaveTextContent(
      "Your identity is verified",
    );
  });

  it("refreshes on a provider status message", async () => {
    mocks.status = status({
      eligibility: "not_started",
      nextAction: "continue",
    });
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Continue verification" }),
    );
    await waitFor(() => expect(mocks.sdkProps).not.toBeNull());
    (mocks.sdkProps?.onStatusChanged as () => void)();
    await waitFor(() => expect(mocks.requestRefresh).toHaveBeenCalled());
  });

  it("lets the user close the session frame again", async () => {
    mocks.status = status({
      eligibility: "not_started",
      nextAction: "continue",
    });
    render(<VerificationDashboard />);
    await userEvent.click(
      screen.getByRole("button", { name: "Continue verification" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("sumsub-sdk-frame")).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Close session" }),
    );
    expect(screen.queryByTestId("sumsub-sdk-frame")).not.toBeInTheDocument();
  });

  it("refreshes the status on demand", async () => {
    mocks.status = status({ eligibility: "pending", nextAction: "wait" });
    render(<VerificationDashboard />);
    await userEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(mocks.requestRefresh).toHaveBeenCalled());
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Status refreshed");
  });
});

describe("accessibility", () => {
  it("labels each region and exposes the steps list", () => {
    render(<VerificationDashboard />);
    expect(
      screen.getByRole("region", { name: "Verification status" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "How it works" }),
    ).toBeInTheDocument();
    const steps = within(
      screen.getByRole("region", { name: "How it works" }),
    ).getByRole("list");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
  });

  it("marks busy buttons for screen readers while a request is running", () => {
    mocks.startPending = true;
    render(<VerificationDashboard />);
    expect(screen.getByRole("button", { name: /Opening/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("keeps the primary action reachable by keyboard", async () => {
    render(<VerificationDashboard />);
    const startButton = screen.getByRole("button", {
      name: "Start verification",
    });
    startButton.focus();
    expect(startButton).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
  });
});
