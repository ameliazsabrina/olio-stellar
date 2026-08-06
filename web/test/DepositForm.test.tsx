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
vi.mock("../src/lib/prover", () => ({
  proveDeposit: vi.fn(async () => ({
    proof: {
      a: new Uint8Array(64),
      b: new Uint8Array(128),
      c: new Uint8Array(64),
    },
    publicSignals: ["1", "50000000"],
    ms: 1,
  })),
}));
vi.mock("../src/lib/crypto", () => ({
  commitment: vi.fn(async () => 1n),
  encryptNote: vi.fn(() => ({
    ephemeralPk: new Uint8Array(32),
    ciphertext: new Uint8Array(48),
  })),
  fromBE: vi.fn(() => 1n),
  randomFieldElement: vi.fn(() => 2n),
  toBaseUnits: (v: string) => BigInt(Math.round(parseFloat(v) * 1e7)),
  toBE32: vi.fn(() => new Uint8Array(32)),
}));

import { DepositForm } from "../src/components/DepositForm";
import { Toaster } from "../src/components/ui/sonner";

const SIGNER = {
  address: "CSIGNER",
  signAuthEntries: async () => [],
  relaySoroban: async () => ({ hash: "deadbeef" }),
};

function renderForm() {
  return render(
    <>
      <DepositForm />
      <Toaster />
    </>,
  );
}

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
    renderForm();
    expect(
      screen.getByRole("heading", { name: /add your own usdc/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /deposit/i }),
    ).toBeInTheDocument();
  });

  it("rejects a zero amount without calling the chain", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/usdc/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument();
    expect(mocks.poolDeposit).not.toHaveBeenCalled();
  });

  it("errors when there is no local account", async () => {
    mocks.getAccount.mockReturnValue(null);
    renderForm();
    await userEvent.type(screen.getByLabelText(/usdc/i), "5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(
      await screen.findByText(/no account on this device/i),
    ).toBeInTheDocument();
    expect(mocks.usdcBalance).not.toHaveBeenCalled();
    expect(mocks.poolDeposit).not.toHaveBeenCalled();
  });

  it("blocks the deposit when the wallet balance is insufficient", async () => {
    mocks.usdcBalance.mockResolvedValue(0n);
    renderForm();
    await userEvent.type(screen.getByLabelText(/usdc/i), "5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(
      await screen.findByText(/not enough testnet usdc/i),
    ).toBeInTheDocument();
    expect(mocks.poolDeposit).not.toHaveBeenCalled();
  });

  it("shields the deposit and reports success", async () => {
    mocks.usdcBalance.mockResolvedValue(1_000_000_000n);
    mocks.poolDeposit.mockResolvedValue(7);
    renderForm();

    const input = screen.getByLabelText(/usdc/i) as HTMLInputElement;
    await userEvent.type(input, "5");
    await userEvent.click(screen.getByRole("button", { name: /deposit/i }));

    expect(
      await screen.findByText(/shielded 5 usdc into your account/i),
    ).toBeInTheDocument();

    expect(mocks.poolDeposit).toHaveBeenCalledTimes(1);
    const [signer, , amount] = mocks.poolDeposit.mock.calls[0];
    expect(signer).toBe(SIGNER);
    expect(amount).toBe(50_000_000n);
    expect(mocks.accountPubkeys).toHaveBeenCalled();

    expect(input.value).toBe("");
  });
});
