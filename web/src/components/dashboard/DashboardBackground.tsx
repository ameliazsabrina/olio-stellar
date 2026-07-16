import type { ReactNode } from "react";

export function DashboardBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh overflow-x-clip bg-paper bg-[url('/assets/section3-bg.webp')] bg-cover bg-fixed bg-center text-white before:pointer-events-none before:absolute before:inset-0 before:bg-gradient-to-br before:from-ink/5 before:via-ink/62 before:to-olive-deep/10">
      <div className="relative min-h-svh">{children}</div>
    </div>
  );
}
