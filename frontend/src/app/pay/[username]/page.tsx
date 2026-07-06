"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "../../../components/WalletProvider";
import {
  commitment,
  encryptNote,
  fromBE,
  randomFieldElement,
  toBaseUnits,
  toBE32
} from "../../../lib/crypto";
import { poolDeposit, resolveUsername, usdcBalance, type OlioAccount } from "../../../lib/stellar";

export default function PayPage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username || "").toLowerCase();
  const { address, connect } = useWallet();

  const [account, setAccount] = useState<OlioAccount | null | "loading">("loading");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    resolveUsername(username)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [username]);

  const pay = useCallback(async () => {
    if (account === "loading" || !account) return;
    const units = toBaseUnits(amount);
    if (units <= 0n) {
      setStatus({ kind: "err", msg: "Enter an amount greater than zero." });
      return;
    }
    setBusy(true);
    try {
      const addr = address || (await connect());
      if ((await usdcBalance(addr)) < units) {
        setStatus({
          kind: "err",
          msg: "Not enough testnet USDC. Add a trustline and fund at faucet.circle.com."
        });
        setBusy(false);
        return;
      }
      setStatus({ kind: "info", msg: "Approve the payment in Freighter…" });

      // Build a shielded note the recipient can spend, with metadata encrypted to them.
      const salt = randomFieldElement();
      const ownerPkField = fromBE(account.note_pubkey);
      const note = toBE32(await commitment(units, ownerPkField, salt));
      const { ephemeralPk, ciphertext } = encryptNote(account.view_pubkey, units, salt);

      const leafIndex = await poolDeposit(addr, note, units, ephemeralPk, ciphertext);
      setStatus({
        kind: "ok",
        msg: `Paid ${amount} USDC to @${username}. Private note #${leafIndex} delivered.`
      });
      setAmount("");
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Payment failed." });
    } finally {
      setBusy(false);
    }
  }, [account, address, amount, connect, username]);

  if (account === "loading") {
    return <div className="panel"><h2>Loading @{username}…</h2></div>;
  }
  if (!account) {
    return (
      <div className="panel">
        <h2>@{username} not found</h2>
        <p className="sub">No Olio account is registered for this username on testnet.</p>
      </div>
    );
  }

  return (
    <>
      <section className="hero">
        <h1>Pay @{username}</h1>
        <p>Your payment becomes a confidential note only the recipient can discover and spend.</p>
      </section>

      <div className="panel">
        <h2>Amount</h2>
        <div className="field">
          <label htmlFor="amount">USDC</label>
          <div className="inline">
            <input
              id="amount"
              inputMode="decimal"
              placeholder="5.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <button onClick={pay} disabled={busy || !amount}>
              {busy ? "Paying…" : "Pay"}
            </button>
          </div>
          <span className="hint">
            {address ? "Paying from your connected wallet." : "You'll connect Freighter to pay."}
          </span>
        </div>
      </div>

      {status ? <div className={`status ${status.kind}`}>{status.msg}</div> : null}
      <p className="foot">Unlinkable receipt · encrypted to the recipient · Built on Stellar</p>
    </>
  );
}
