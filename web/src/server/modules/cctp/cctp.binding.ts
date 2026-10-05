import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { cctpBinding, cctpIntakeContract, cctpStellar, EVM_SOURCES, solanaSource } from "../../../lib/cctp";
import { parseCctpMessage } from "../../../lib/cctpMessage";
import { base58ToBytes, bytesToHex, hexToBytes } from "../../../lib/crypto";
import type { SignedFeeQuote } from "../../../lib/fee-quote";
import { CctpOperationalError } from "./cctp.errors";

export function matchesQuote(message: string, quote: SignedFeeQuote, attested = true): boolean {
  try {
    const msg = parseCctpMessage(message);
    const source = EVM_SOURCES[quote.sourceDomain];
    const burnToken = quote.sourceDomain === 5 ? base58ToBytes(solanaSource.usdcMint) : hexToBytes(source.usdc.slice(2).padStart(64, "0"));
    // Solana's message transmitter authenticates the sender program via its sender_authority PDA.
    const sender = quote.sourceDomain === 5 ? base58ToBytes(solanaSource.tokenMessengerMinter) : hexToBytes(source.tokenMessenger.slice(2).padStart(64, "0"));
    const equal = (a: Uint8Array, b: Uint8Array) => bytesToHex(a) === bytesToHex(b);
    return msg.version === 1 && msg.bodyVersion === 1 && msg.sourceDomain === quote.sourceDomain && msg.destinationDomain === 27 &&
      equal(msg.sender, sender) && equal(msg.recipient, StrKey.decodeContract(cctpStellar.tokenMessengerMinter)) &&
      equal(msg.destinationCaller, new Uint8Array(32)) && equal(msg.burnToken, burnToken) &&
      equal(msg.mintRecipient, StrKey.decodeContract(cctpIntakeContract)) && equal(msg.messageSender, quote.sourcePayer) &&
      equal(msg.hookData, cctpBinding(quote)) && msg.amount * 10n === quote.totalAmount &&
      msg.maxFee === 0n && msg.feeExecuted === 0n && msg.minFinality === 2000 && (!attested || msg.finalityExecuted >= 2000);
  } catch { return false; }
}
export function assertMessageBinding(message: string, quote: SignedFeeQuote) {
  if (!matchesQuote(message, quote)) throw new CctpOperationalError("binding");
}
