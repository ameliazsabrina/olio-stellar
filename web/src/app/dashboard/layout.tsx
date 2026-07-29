import type { ReactNode } from "react";
import { DashboardBackground } from "../../components/dashboard/DashboardBackground";
import { DashboardShell } from "../../components/dashboard/DashboardShell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardBackground>
      <DashboardShell navigation>{children}</DashboardShell>
    </DashboardBackground>
  );
}
