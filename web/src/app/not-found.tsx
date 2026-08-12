import { ArrowLeft, LayoutDashboard } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { buttonVariants } from "@/components/ui/button";
import { DASHBOARD_PATH } from "@/lib/auth-routes";

export default function NotFound() {
  return (
    <DashboardBackground>
      <DashboardShell contentClassName="flex min-h-svh flex-col items-center">
        <header className="flex min-w-0 items-center pt-4">
          <Link href="/" aria-label="Olio home" className="block size-14">
            <Image
              src="/assets/olio-white.svg"
              alt=""
              width={56}
              height={56}
              className="size-14"
            />
          </Link>
        </header>

        <section
          className="flex flex-1 items-center py-12 sm:py-16 text-center"
          aria-labelledby="not-found-title"
        >
          <div className="max-w-xl">
            <p className="mb-3 text-sm font-semibold tracking-wide text-brand-linen/60">
              Error 404
            </p>
            <h1
              id="not-found-title"
              className="font-heading text-4xl font-bold tracking-tight text-brand-linen sm:text-5xl"
            >
              Page not found.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 font-medium text-brand-linen/70 sm:text-base sm:leading-7">
              We could not find the page you were looking for. Check the address
              or head back to a familiar place.
            </p>

            <nav
              aria-label="Not found recovery"
              className="mt-7 flex flex-col gap-3 sm:flex-row items-center sm:justify-center sm:gap-4"
            >
              <Link
                href="/"
                className={buttonVariants({
                  variant: "glass",
                  size: "lg",
                  className:
                    "w-full bg-brand-linen/25 ring-brand-linen/45 hover:bg-brand-linen/30 sm:w-auto",
                })}
              >
                <ArrowLeft aria-hidden="true" />
                Go home
              </Link>
              <Link
                href={DASHBOARD_PATH}
                className={buttonVariants({
                  variant: "glass",
                  size: "lg",
                  className: "w-full sm:w-auto",
                })}
              >
                <LayoutDashboard aria-hidden="true" />
                Open dashboard
              </Link>
            </nav>
          </div>
        </section>
      </DashboardShell>
    </DashboardBackground>
  );
}
