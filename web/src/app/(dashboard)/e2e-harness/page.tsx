import { notFound } from "next/navigation";
import { PassportDashboard } from "@/components/dashboard/PassportDashboard";
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
    <PassportDashboard />
  ) : (
    <VerificationDashboard />
  );
}
