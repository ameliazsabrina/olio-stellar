import { PASSKEY_SESSION_COOKIE } from "./auth-routes";

const PASSKEY_SESSION_VALUE = "passkey";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function secureCookieFlag(): string {
  if (typeof window === "undefined") return "";
  return window.location.protocol === "https:" ? "; secure" : "";
}

export function rememberPasskeySession(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${PASSKEY_SESSION_COOKIE}=${PASSKEY_SESSION_VALUE}; path=/; max-age=${THIRTY_DAYS}; samesite=lax${secureCookieFlag()}`;
}

export function forgetPasskeySession(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${PASSKEY_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax${secureCookieFlag()}`;
}
