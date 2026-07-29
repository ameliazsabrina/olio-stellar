import Image from "next/image";
import type { ReactNode } from "react";
import dashboardBackground from "../../assets/dashboard-background.webp";

export function DashboardBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-svh overflow-x-clip bg-paper text-white">
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <Image
          src={dashboardBackground}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-olive-deep/30" />
      </div>
      <div className="relative z-10 min-h-svh">{children}</div>
    </div>
  );
}
