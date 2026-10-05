export const OPEN_VERIFICATION = "olio:open-verification";
export function openVerification(businessId?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_VERIFICATION, { detail: { businessId } }),
  );
}
