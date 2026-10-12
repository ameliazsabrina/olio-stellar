import { notFound } from "next/navigation";
import { PassportTiles } from "@/components/dashboard/PassportTiles";
import { VerificationDashboard } from "@/components/dashboard/VerificationDashboard";

export const dynamic = "force-dynamic";

export default async function VerificationHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  if (process.env.E2E_HARNESS !== "1") notFound();
  const { screen } = await searchParams;
  return screen === "passport" ? (
    <div className="grid grid-cols-1 gap-4 pb-16 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
      <PassportTiles />
    </div>
  ) : (
    <VerificationDashboard />
  );
}
