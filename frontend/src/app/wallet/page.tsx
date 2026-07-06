"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../../components/WalletProvider";
import {
  fromBaseUnits,
  merkleProof,
  nullifier,
  recipientField,
  toBE32,
  TREE_DEPTH
} from "../../lib/crypto";
import { getAccount, scanMyNotes, type LocalAccount, type MyNote, type ScanResult } from "../../lib/notes";
import { proveWithdraw } from "../../lib/prover";
import { poolWithdraw } from "../../lib/stellar";

export default function WalletPage() {
  const { address, getSigner } = useWallet();
  const [acct, setAcct] = useState<LocalAccount | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [dest, setDest] = useState("");
  const [busyLeaf, setBusyLeaf] = useState<number | null>(null);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    setAcct(getAccount());
  }, []);
  useEffect(() => {
    if (address) setDest((d) => d || address);
  }, [address]);

  const doScan = useCallback(async () => {
    const a = getAccount();
    if (!a) return;
    setScanning(true);
    setStatus({ kind: "info", msg: "Scanning and decrypting your notes…" });
    try {
      const result = await scanMyNotes(a);
      setScan(result);
      setStatus(
        result.notes.length
          ? null
          : { kind: "info", msg: "No notes yet. Share your link to receive a payment." }
      );
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Scan failed." });
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (acct) doScan();
  }, [acct, doScan]);

  const claim = useCallback(
    async (note: MyNote) => {
      const a = getAccount();
      if (!scan || !a) return;
      const destination = (dest || address).trim();
      if (!destination) {
        setStatus({ kind: "err", msg: "Connect a wallet or enter a destination address." });
        return;
      }
      setBusyLeaf(note.leafIndex);
      try {
        const signer = getSigner();

        setStatus({ kind: "info", msg: "Generating zero-knowledge proof in your browser…" });
        const { root, pathElements, pathIndices } = await merkleProof(
          scan.leaves,
          note.leafIndex,
          TREE_DEPTH
        );
        const nf = await nullifier(a.ownerSecret, note.leafIndex);
        const recipientFr = recipientField(destination);

        const { proof, ms } = await proveWithdraw({
          root: root.toString(),
          nullifier: nf.toString(),
          recipient: recipientFr.toString(),
          amount: note.amount.toString(),
          ownerSecret: a.ownerSecret.toString(),
          salt: note.salt.toString(),
          pathElements: pathElements.map((x) => x.toString()),
          pathIndices
        });

        setStatus({ kind: "info", msg: `Proof ready in ${Math.round(ms)} ms. Approve in your wallet…` });
        await poolWithdraw(signer, destination, note.amount, toBE32(root), toBE32(nf), proof);

        setStatus({
          kind: "ok",
          msg: `Claimed ${fromBaseUnits(note.amount)} USDC to ${destination.slice(0, 6)}… (proof ${Math.round(ms)} ms)`
        });
        await doScan();
      } catch (e) {
        setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Claim failed." });
      } finally {
        setBusyLeaf(null);
      }
    },
    [address, getSigner, dest, doScan, scan]
  );

  if (!acct) {
    return (
      <div className="panel">
        <h2>No account on this device</h2>
        <p className="sub">Create your Olio account first — your keys live in this browser.</p>
        <Link className="btnlike" href="/">
          Create account →
        </Link>
      </div>
    );
  }

  const claimable = scan ? fromBaseUnits(scan.claimable) : "—";

  return (
    <>
      <section className="hero">
        <h1>Wallet</h1>
        <p>Notes you&apos;ve received in the shielded pool. Claim to any Stellar address.</p>
      </section>

      <div className="panel">
        <h2>Claimable balance</h2>
        <div className="bignum">
          {claimable} <small>USDC</small>
        </div>
        <button className="secondary" onClick={doScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Rescan"}
        </button>
      </div>

      <div className="panel">
        <h2>Claim to</h2>
        <div className="field">
          <label htmlFor="dest">Destination address</label>
          <input
            id="dest"
            className="mono"
            placeholder="G…"
            value={dest}
            onChange={(e) => setDest(e.target.value.trim())}
          />
          <span className="hint">
            A zero-knowledge proof breaks the link between the deposit and this payout.
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>Your notes</h2>
        {scan && scan.notes.length ? (
          <div className="notes">
            {scan.notes.map((n) => (
              <div className="note" key={n.leafIndex}>
                <span className="amt">{fromBaseUnits(n.amount)} USDC</span>
                <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
                  note #{n.leafIndex}
                </span>
                {n.spent ? (
                  <span className="tag spent">spent</span>
                ) : (
                  <button onClick={() => claim(n)} disabled={busyLeaf !== null}>
                    {busyLeaf === n.leafIndex ? "Proving…" : "Claim"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="sub">Nothing here yet.</p>
        )}
      </div>

      {status ? <div className={`status ${status.kind}`}>{status.msg}</div> : null}
      <p className="foot">Proofs generated locally · your secrets never leave this device</p>
    </>
  );
}
