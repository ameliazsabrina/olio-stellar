// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  wallet: {} as any,
  data: {} as any,
  refetch: vi.fn(),
  create: vi.fn(),
  bind: vi.fn(),
  start: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
  sdk: {} as any,
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => mocks.wallet,
}));
vi.mock("../src/features/verification/SumsubVerification", () => ({
  SumsubVerification: (props: any) => {
    mocks.sdk = props;
    return <div>Secure SDK</div>;
  },
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      verification: {
        onboarding: { invalidate: mocks.invalidate },
        status: { invalidate: mocks.invalidate },
      },
    }),
    businesses: {
      create: { useMutation: () => ({ mutateAsync: mocks.create }) },
      bindAccount: { useMutation: () => ({ mutateAsync: mocks.bind }) },
      updateProfile: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    verification: {
      onboarding: {
        useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }),
      },
      status: { useQuery: () => ({ data: undefined }) },
      start: { useMutation: () => ({ mutateAsync: mocks.start }) },
      refresh: { useMutation: () => ({ mutateAsync: mocks.refresh }) },
      sdkToken: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
import { VerificationController } from "../src/features/verification/VerificationController";
import { openVerification } from "../src/features/verification/openVerification";
const app = () => (
  <VerificationController>
    <div>Dashboard content</div>
  </VerificationController>
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.wallet = {
    address: "account-a",
    authenticated: true,
    sessionReady: true,
    username: "alice",
    accountUnlocked: true,
    connecting: false,
    pinModalOpen: false,
    usernameModalOpen: false,
    disconnect: vi.fn(),
  };
  mocks.data = {
    business: null,
    status: null,
    submitted: false,
    serviceAvailable: true,
  };
  mocks.refetch.mockResolvedValue({ data: mocks.data });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
});
describe("shared verification controller", () => {
  it.each([
    "pinModalOpen",
    "usernameModalOpen",
  ])("does not stack over %s", async (flag) => {
    mocks.wallet[flag] = true;
    const view = render(app());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    mocks.wallet[flag] = false;
    view.rerender(app());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
  it("requires submission, blocks Escape, and offers sign out", async () => {
    render(app());
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.wallet.disconnect).toHaveBeenCalled();
  });
  it("does not prompt approved users and reopens from a shared entry point", async () => {
    mocks.data = {
      ...mocks.data,
      submitted: true,
      status: { eligibility: "approved" },
    };
    render(app());
    await screen.findByText("Dashboard content");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => openVerification());
    expect(
      await screen.findByRole("button", { name: "Continue to dashboard" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to dashboard" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("waits for server confirmation after SDK submission", async () => {
    mocks.data.business = { businessId: "biz", type: "company" };
    const view = render(app());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/company registration documents/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Secure SDK");
    act(() => mocks.sdk.onSubmitted());
    expect(screen.getByText(/Confirming submission/)).toBeInTheDocument();
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
    mocks.data = {
      ...mocks.data,
      submitted: true,
      status: {
        firstSubmittedAt: new Date().toISOString(),
        eligibility: "pending",
        userMessage: "Under review",
      },
    };
    view.rerender(app());
    expect(
      await screen.findByRole("button", { name: "Continue to dashboard" }),
    ).toBeEnabled();
    expect(screen.getByText("Under review")).toBeInTheDocument();
  });
  it("advances when the SDK reports an already-reviewed applicant", async () => {
    mocks.data.business = { businessId: "biz", type: "individual" };
    const view = render(app());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/government-issued ID/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Secure SDK");
    act(() => mocks.sdk.onStatusChanged(true));
    expect(screen.getByText(/Confirming submission/)).toBeInTheDocument();
    mocks.data = {
      ...mocks.data,
      submitted: true,
      status: { firstSubmittedAt: new Date().toISOString(), userMessage: "Verified" },
    };
    view.rerender(app());
    expect(
      await screen.findByRole("button", { name: "Continue to dashboard" }),
    ).toBeEnabled();
  });
  it("refresh moves a provider-submitted step 3 to step 4", async () => {
    mocks.data.business = { businessId: "biz", type: "individual" };
    render(app());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/government-issued ID/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Secure SDK");
    mocks.refresh.mockResolvedValue({
      status: { firstSubmittedAt: new Date().toISOString() },
      reconciled: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() =>
      expect(mocks.refresh).toHaveBeenCalledWith({ businessId: "biz" }),
    );
    expect(await screen.findByText("4. Submitted")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
  it("coalesces bursts of SDK status events into one refresh", async () => {
    mocks.data.business = { businessId: "biz", type: "individual" };
    render(app());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/government-issued ID/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Secure SDK");
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    const before = mocks.refresh.mock.calls.length;
    await act(async () => {
      mocks.sdk.onStatusChanged(false);
      mocks.sdk.onStatusChanged(false);
      mocks.sdk.onStatusChanged(false);
    });
    expect(mocks.refresh.mock.calls.length - before).toBeLessThanOrEqual(1);
  });
  it("treats a throttled refresh as pending, not a failure", async () => {
    mocks.data.business = { businessId: "biz", type: "individual" };
    mocks.refresh.mockRejectedValue({ data: { code: "TOO_MANY_REQUESTS" } });
    render(app());
    await screen.findByRole("dialog");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(
      screen.queryByText(/could not confirm your status/),
    ).not.toBeInTheDocument();
  });
  it("keeps unavailable service required and resets on account switch", async () => {
    mocks.data.serviceAvailable = false;
    const view = render(app());
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    mocks.wallet = { ...mocks.wallet, address: "account-b", username: null };
    view.rerender(app());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard content")).not.toBeInTheDocument();
  });
});
