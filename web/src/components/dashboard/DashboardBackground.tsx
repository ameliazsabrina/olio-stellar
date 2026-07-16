import type { ReactNode } from "react";

export function DashboardBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh overflow-x-clip bg-paper bg-[url('/assets/section3-bg.webp')] bg-cover bg-fixed bg-center text-white before:bg-olive-deep/10">
      <div className="relative min-h-svh">{children}</div>
    </div>
  );
}
