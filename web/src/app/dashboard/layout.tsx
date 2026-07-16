import type { ReactNode } from "react";
import { DashboardBackground } from "../../components/dashboard/DashboardBackground";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardBackground>{children}</DashboardBackground>;
}
