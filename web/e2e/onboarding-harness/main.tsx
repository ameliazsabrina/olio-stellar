import { createRoot } from "react-dom/client";
import "../../src/app/globals.css";
import { VerificationController } from "../../src/features/verification/VerificationController";
import { NotificationInbox } from "../../src/components/dashboard/NotificationInbox";
createRoot(document.getElementById("root")!).render(
  <div
    className="theme-product min-h-screen bg-brand-obsidian p-6 text-brand-linen"
    style={{
      background: "url(/assets/dashboard.jpg) center / cover, #1a1f12",
    }}
  >
    <header className="flex justify-end gap-3">
      <NotificationInbox />
      <button aria-label="Profile menu">Profile</button>
    </header>
    <VerificationController>
      <h1>Dashboard is available</h1>
    </VerificationController>
  </div>,
);
