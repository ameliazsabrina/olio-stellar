"use client";

// Per-link manage capability tokens, returned once at creation and kept only in
// this browser. Presenting one proves ownership for edit/archive/delete; without
// it those mutations return UNAUTHORIZED, so enumerated ids are useless to attackers.
const STORAGE_KEY = "olio.paymentLinkManageTokens";

type TokenMap = Record<string, string>;

function readAll(): TokenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as TokenMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: TokenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort; storage may be unavailable or full
  }
}

export function storeManageToken(id: string, token: string): void {
  const map = readAll();
  map[id] = token;
  writeAll(map);
}

export function getManageToken(id: string): string | null {
  return readAll()[id] ?? null;
}

export function removeManageToken(id: string): void {
  const map = readAll();
  if (id in map) {
    delete map[id];
    writeAll(map);
  }
}
