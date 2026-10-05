import { VerificationController } from "@/features/verification/VerificationController";
import type { ReactNode } from "react";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardBackground>
      <DashboardShell navigation>
        <VerificationController>{children}</VerificationController>
      </DashboardShell>
    </DashboardBackground>
  );
}
