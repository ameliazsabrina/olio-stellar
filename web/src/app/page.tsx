"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { DepositForm } from "../components/DepositForm";
import { EditionsChrome } from "../components/landing/Chrome";
import { EditionsHero } from "../components/landing/Hero";
import { EdArticle, EditionsSection } from "../components/landing/Section";
import { useWallet } from "../components/WalletProvider";
import { WalletStatus } from "../components/WalletStatus";
import { getAccount } from "../lib/notes";
import {
  addUsdcTrustline,
  poolId,
  registryId,
  usdcBalanceLabel,
} from "../lib/stellar";
import {
  bignum,
  btn,
  btnSecondary,
  edGrid,
  inline,
  panel,
  status as statusClass,
  sub,
} from "../lib/ui";

const configured = Boolean(registryId && poolId);

export default function Home() {
  const { address, getSigner, username, openUsernameModal } = useWallet();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    kind: "info" | "ok" | "err";
    msg: string;
  } | null>(null);
  const [balance, setBalance] = useState("—");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!address) return;
    usdcBalanceLabel(address)
      .then(setBalance)
      .catch(() => {});
  }, [address]);

  const addTrustline = useCallback(async () => {
    setBusy(true);
    try {
      const signer = getSigner();
      setStatus({ kind: "info", msg: "Approve the trustline in your wallet…" });
      await addUsdcTrustline(signer);
      setBalance(await usdcBalanceLabel(signer.address));
      setStatus({ kind: "ok", msg: "USDC trustline added." });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Failed to add trustline.",
      });
    } finally {
      setBusy(false);
    }
  }, [getSigner]);

  if (!configured) {
    return (
      <div className={panel}>
        <h2 className="text-lg font-semibold text-ink">
          Contracts not configured
        </h2>
        <p className={sub}>
          Run <span className="font-mono">./scripts/deploy-testnet.sh</span> and
          restart the dev server.
        </p>
      </div>
    );
  }

  const hasAccount = Boolean(username && getAccount());
  const payLink = username ? `${origin}/pay/${username}` : "";

  return (
    <EditionsChrome>
      <EditionsHero />

      <div className="relative z-10 mx-auto max-w-[1140px] px-[clamp(24px,5vw,72px)] pb-[120px]">
        <EditionsSection
          id="links"
          title="Payment links"
          narrative="Public wallets were never designed for your business. Share a payment link instead, and keep every payment confidential by default."
        >
          <div className={edGrid}>
            <EdArticle title="Share a payment link" variant={0}>
              Create a payment request in seconds and send it like any normal
              invoice — no complicated crypto knowledge required.
            </EdArticle>
            <EdArticle title="Get paid in USDC" variant={1}>
              Your client pays normally using supported stablecoin rails,
              settling on Stellar in seconds — fast, low fees, and cash-out
              through Stellar's payment ecosystem.
            </EdArticle>
            <EdArticle title="Keep your payment private" variant={5}>
              Your receipt is stored privately, not exposed on a public wallet
              for everyone to inspect. Amounts, senders, and history stay
              between the two of you.
            </EdArticle>
            <EdArticle title="Nothing to see" variant={4}>
              Your wallet history shows no incoming payments at all. Each
              arrival is a fresh note, encrypted so only you can read what it
              holds.
            </EdArticle>
          </div>
        </EditionsSection>

        <EditionsSection
          id="shield"
          title="Shielded pool"
          narrative="Private by default. Provable when needed. Olio creates a private payment receipt every time you get paid — confidential, yet verifiable whenever you need to show proof."
        >
          <div className={edGrid}>
            <EdArticle title="A fresh note per payment" variant={2}>
              Every payment mints a new note — a Poseidon commitment in the
              pool's Merkle tree. Notes carry no name, no address, no history.
            </EdArticle>
            <EdArticle title="Encrypted to your view key" variant={5}>
              Amounts and secrets are sealed to your keys. You can always read
              your own notes; nobody else can, including us.
            </EdArticle>
            <EdArticle title="One pool, many senders" variant={0}>
              Everyone's deposits share the same anonymity set. Only you control
              who sees your payments — income visible forever becomes
              confidential by default.
            </EdArticle>
            <EdArticle title="Native to the BN254 field" variant={4}>
              Commitments are computed with circuit-friendly Poseidon hashing
              over BN254 — the same arithmetic the proofs speak, with no
              translation loss.
            </EdArticle>
          </div>
        </EditionsSection>

        <EditionsSection
          id="withdraw"
          title="Withdrawals"
          narrative="Reveal only the payment you choose. Prove a note is yours to banks, accountants, or tax authorities — without exposing everything else."
        >
          <div className={edGrid}>
            <EdArticle title="Proved in your browser" variant={3}>
              The Groth16 proof is generated locally from the circuit's WASM —
              your secrets never leave the tab that holds them.
            </EdArticle>
            <EdArticle title="Verified on Soroban" variant={4}>
              A verifier contract checks the proof on-chain over BN254. Sixteen
              pairing checks stand between the pool and anyone without the
              secret.
            </EdArticle>
            <EdArticle title="Spent once, linked never" variant={2}>
              A nullifier retires the note so it can't be spent twice — while
              revealing nothing about which deposit it retired.
            </EdArticle>
            <EdArticle title="To any address" variant={1}>
              Withdraw to a fresh account and the trail ends there: no on-chain
              thread connects the exit to the deposit that funded it.
            </EdArticle>
          </div>
        </EditionsSection>

        <EditionsSection
          id="start"
          title="Get started"
          narrative="The future of getting paid is private. Join the first freelancers, creators, and businesses using confidential stablecoin payments."
        >
          <div className="mt-11 grid w-[min(560px,100%)] gap-4">
            <div className="rounded-lg border border-ed-line border-l-4 border-l-ed-gold bg-white/[0.08] px-4 py-3 text-sm text-ed-cream/90">
              <b className="text-ed-gold">Testnet · Zero-knowledge.</b> Payments
              arrive as shielded notes; withdrawals are proven in your browser
              and reveal nothing linking them to the deposit. Note details are
              encrypted to you.
            </div>

            <WalletStatus />

            {!address ? (
              <div className={`${panel} bg-ed-cream border-ink/10`}>
                <h2 className="text-lg font-semibold text-ink">
                  Connect your wallet
                </h2>
                <p className={sub}>
                  Connect a wallet (top right) to claim your username and start
                  getting paid privately.
                </p>
              </div>
            ) : !hasAccount ? (
              <div className={`${panel} bg-ed-cream border-ink/10`}>
                <h2 className="text-lg font-semibold text-ink">
                  Claim your username
                </h2>
                <p className={sub}>
                  Pick a username to get your payment link and start receiving
                  private payments.
                </p>
                <button
                  className={`${btn} self-start`}
                  onClick={openUsernameModal}
                >
                  Claim your username →
                </button>
              </div>
            ) : (
              <>
                <DepositForm />

                <div className={`${panel} bg-ed-cream border-ink/10`}>
                  <h2 className="text-lg font-semibold text-ink">
                    Your payment link
                  </h2>
                  <p className={sub}>
                    Anyone can pay you here. Each payment arrives as a fresh,
                    private note.
                  </p>
                  <div className="flex flex-col items-center gap-3">
                    {payLink ? (
                      <div className="rounded-lg border border-line bg-white p-4">
                        <QRCodeSVG
                          value={payLink}
                          size={168}
                          fgColor="#292919"
                          bgColor="#ffffff"
                        />
                      </div>
                    ) : null}
                    <div className="break-all font-mono text-sm text-muted">
                      {payLink || "…"}
                    </div>
                    <button
                      className={btnSecondary}
                      onClick={() => navigator.clipboard?.writeText(payLink)}
                      disabled={!payLink}
                    >
                      Copy link
                    </button>
                  </div>
                </div>

                <div className={`${panel} bg-ed-cream border-ink/10`}>
                  <h2 className="text-lg font-semibold text-ink">
                    @{username}
                  </h2>
                  <div className={bignum}>
                    {balance}{" "}
                    <small className="text-base font-normal text-muted">
                      USDC in wallet
                    </small>
                  </div>
                  <p className={sub}>
                    Your wallet needs a USDC trustline (and testnet USDC) to{" "}
                    <em>pay</em> links and deposit. Each payment you receive
                    arrives as a fresh, private note only you can read.
                  </p>
                  <div className={inline}>
                    <button
                      className={btnSecondary}
                      onClick={addTrustline}
                      disabled={busy}
                    >
                      Add USDC trustline
                    </button>
                    <a
                      className={btnSecondary}
                      href="https://faucet.circle.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get testnet USDC ↗
                    </a>
                  </div>
                </div>
              </>
            )}

            {status ? (
              <div className={statusClass(status.kind)}>{status.msg}</div>
            ) : null}
          </div>
        </EditionsSection>
      </div>
    </EditionsChrome>
  );
}
