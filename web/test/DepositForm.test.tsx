// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  getAccount: vi.fn(),
  accountPubkeys: vi.fn(),
  poolDeposit: vi.fn(),
  usdcBalance: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: mocks.getAccount,
  accountPubkeys: mocks.accountPubkeys,
}));
vi.mock("../src/lib/stellar", () => ({
  poolDeposit: mocks.poolDeposit,
  usdcBalance: mocks.usdcBalance,
}));
vi.mock("../src/lib/crypto", () => ({
  commitment: vi.fn(async () => 1n),
  encryptNote: vi.fn(() => ({
    ephemeralPk: new Uint8Array(32),
    ciphertext: new Uint8Array(48),
  })),
  fromBE: vi.fn(() => 1n),
  randomFieldElement: vi.fn(() => 2n),
  // 7 decimals, matching USDC base units.
  toBaseUnits: (v: string) => BigInt(Math.round(parseFloat(v) * 1e7)),
  toBE32: vi.fn(() => new Uint8Array(32)),
}));

import { DepositForm } from "../src/components/DepositForm";

const SIGNER = {
  address: "CSIGNER",
  signAuthEntries: async () => [],
  relaySoroban: async () => ({ hash: "deadbeef" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useWallet.mockReturnValue({
    address: "CSIGNER",
    getSigner: () => SIGNER,
  });
  mocks.getAccount.mockReturnValue({
    ownerSecret: 1n,
    viewSk: new Uint8Array(32),
  });
  mocks.accountPubkeys.mockResolvedValue({
    notePubkey: new Uint8Array(32).fill(1),
    viewPubkey: new Uint8Array(32).fill(2),
  });
});

describe("DepositForm", () => {
  it("renders the heading and deposit control", () => {
    render(<DepositForm />);
    expect(
      screen.getByRole("heading", { name: /add your own usdc/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /deposit/i }),
    ).toBeInTheDocument();
  });

  it("rejects a zero amount without calling the chain", async () => {
    render(<DepositForm />);
    await userEvent.type(screen.getByLabelText(/usdc/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument();
    expect(mocks.poolDeposit).not.toHaveBeenCalled();
  });

  it("errors when there is no local account", async () => {
    mocks.getAccount.mockReturnValue(null);
    render(<DepositForm />);
    await userEvent.type(screen.getByLabelText(/usdc/i), "5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(
      await screen.findByText(/no account on this device/i),
    ).toBeInTheDocument();
    expect(mocks.usdcBalance).not.toHaveBeenCalled();
    expect(mocks.poolDeposit).not.toHaveBeenCalled();
  });

  it("blocks the deposit when the wallet balance is insufficient", async () => {
    mocks.usdcBalance.mockResolvedValue(0n); // less than 5 USDC in base units
    render(<DepositForm />);
    await userEvent.type(screen.getByLabelText(/usdc/i), "5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(
      await screen.findByText(/not enough testnet usdc/i),
    ).toBeInTheDocument();
    expect(mocks.poolDeposit).not.toHaveBeenCalled();
  });

  it("shields the deposit and reports the note index on success", async () => {
    mocks.usdcBalance.mockResolvedValue(1_000_000_000n); // plenty
    mocks.poolDeposit.mockResolvedValue(7);
    render(<DepositForm />);

    const input = screen.getByLabelText(/usdc/i) as HTMLInputElement;
    await userEvent.type(input, "5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(
      await screen.findByText(/shielded 5 usdc into your account · note #7/i),
    ).toBeInTheDocument();

    // Deposited to the user's OWN pubkeys, with the amount in base units (5 * 1e7).
    expect(mocks.poolDeposit).toHaveBeenCalledTimes(1);
    const [signer, , amount] = mocks.poolDeposit.mock.calls[0];
    expect(signer).toBe(SIGNER);
    expect(amount).toBe(50_000_000n);
    expect(mocks.accountPubkeys).toHaveBeenCalled();

    // Form resets after a successful deposit.
    expect(input.value).toBe("");
  });
});
