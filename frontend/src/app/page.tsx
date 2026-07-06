"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "../components/WalletProvider";
import {
  accountPubkeys,
  ensureAccount,
  getAccount,
  getStoredUsername,
  setStoredUsername
} from "../lib/notes";
import {
  addUsdcTrustline,
  poolId,
  registerUsername,
  registryId,
  usdcBalanceLabel,
  usernameOf
} from "../lib/stellar";

const configured = Boolean(registryId && poolId);

export default function Home() {
  const { address, connect } = useWallet();
  const [username, setUsername] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; msg: string } | null>(null);
  const [balance, setBalance] = useState("—");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setUsername(getStoredUsername());
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!address) return;
    usernameOf(address)
      .then((name) => {
        if (name) {
          setUsername(name);
          setStoredUsername(name);
        }
      })
      .catch(() => {});
    usdcBalanceLabel(address).then(setBalance).catch(() => {});
  }, [address]);

  const createAccount = useCallback(async () => {
    const name = input.trim().toLowerCase();
    if (name.length < 3) {
      setStatus({ kind: "err", msg: "Username must be at least 3 characters." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "info", msg: "Approve the transaction in Freighter…" });
    try {
      const addr = address || (await connect());
      const acct = ensureAccount();
      const { notePubkey, viewPubkey } = await accountPubkeys(acct);
      await registerUsername(addr, name, notePubkey, viewPubkey);
      setStoredUsername(name);
      setUsername(name);
      setStatus({ kind: "ok", msg: `@${name} is yours. Share your link to get paid privately.` });
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Registration failed." });
    } finally {
      setBusy(false);
    }
  }, [address, connect, input]);

  const addTrustline = useCallback(async () => {
    setBusy(true);
    setStatus({ kind: "info", msg: "Approve the trustline in Freighter…" });
    try {
      const addr = address || (await connect());
      await addUsdcTrustline(addr);
      setBalance(await usdcBalanceLabel(addr));
      setStatus({ kind: "ok", msg: "USDC trustline added." });
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Failed to add trustline." });
    } finally {
      setBusy(false);
    }
  }, [address, connect]);

  if (!configured) {
    return (
      <div className="panel">
        <h2>Contracts not configured</h2>
        <p className="sub">
          Run <span className="mono">./scripts/deploy-testnet.sh</span> and restart the dev server.
        </p>
      </div>
    );
  }

  const hasAccount = Boolean(username && getAccount());
  const payLink = username ? `${origin}/pay/${username}` : "";

  return (
    <>
      <section className="hero">
        <h1>Get paid in USDC, privately.</h1>
        <p>Share a link, receive stablecoin payments as unlinkable notes, cash out when you want.</p>
      </section>

      <div className="banner ok">
        <b>Testnet · Zero-knowledge.</b> Payments arrive as shielded notes; withdrawals are proven in
        your browser and reveal nothing linking them to the deposit. Note details are encrypted to you.
      </div>

      {hasAccount ? (
        <>
          <div className="panel">
            <h2>Your payment link</h2>
            <p className="sub">Anyone can pay you here. Each payment arrives as a fresh, private note.</p>
            <div className="qr">
              {payLink ? (
                <div className="box">
                  <QRCodeSVG value={payLink} size={168} fgColor="#333e22" bgColor="#ffffff" />
                </div>
              ) : null}
              <div className="linkrow">{payLink || "…"}</div>
              <button
                className="secondary"
                onClick={() => navigator.clipboard?.writeText(payLink)}
                disabled={!payLink}
              >
                Copy link
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>@{username}</h2>
            <div className="bignum">
              {balance} <small>USDC in wallet</small>
            </div>
            <p className="sub">
              Your wallet needs a USDC trustline (and testnet USDC) to <em>pay</em> links. Received
              notes live in the pool — see <Link href="/wallet">Wallet</Link>.
            </p>
            <div className="inline">
              <button className="secondary" onClick={addTrustline} disabled={busy}>
                Add USDC trustline
              </button>
              <a
                className="btnlike secondary"
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
              >
                Get testnet USDC ↗
              </a>
            </div>
            <Link className="btnlike" href="/wallet">
              Open wallet →
            </Link>
          </div>
        </>
      ) : (
        <div className="panel">
          <h2>Create your account</h2>
          <p className="sub">Pick a username — it becomes your payment link, like olio/@dinar.</p>
          <div className="field">
            <label htmlFor="username">Username</label>
            <div className="inline">
              <input
                id="username"
                placeholder="dinar"
                value={input}
                maxLength={32}
                onChange={(e) => setInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
              />
              <button onClick={createAccount} disabled={busy || input.trim().length < 3}>
                {busy ? "Working…" : "Claim"}
              </button>
            </div>
            <span className="hint">3–32 characters. Letters, numbers, underscore.</span>
          </div>
        </div>
      )}

      {status ? <div className={`status ${status.kind}`}>{status.msg}</div> : null}
      <p className="foot">Built on Stellar · Soroban · Groth16 over BN254 · Testnet</p>
    </>
  );
}
