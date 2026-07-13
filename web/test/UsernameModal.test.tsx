// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  setUsername: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ setUsername: mocks.setUsername, error: "" }),
}));

// Stub the form so we can drive its onClaimed callback directly.
vi.mock("../src/components/CreateAccountForm", () => ({
  CreateAccountForm: ({ onClaimed }: { onClaimed: (u: string) => void }) => (
    <button type="button" onClick={() => onClaimed("alice")}>
      STUB_CLAIM
    </button>
  ),
}));

import { UsernameModal } from "../src/components/UsernameModal";

beforeEach(() => vi.clearAllMocks());

describe("UsernameModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <UsernameModal open={false} onClose={mocks.onClose} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the username form when open", () => {
    render(<UsernameModal open onClose={mocks.onClose} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("STUB_CLAIM")).toBeInTheDocument();
  });

  it("updates the wallet username and closes on a successful claim", async () => {
    render(<UsernameModal open onClose={mocks.onClose} />);
    await userEvent.click(screen.getByText("STUB_CLAIM"));

    expect(mocks.setUsername).toHaveBeenCalledWith("alice");
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    render(<UsernameModal open onClose={mocks.onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(mocks.onClose).toHaveBeenCalled();
  });
});
