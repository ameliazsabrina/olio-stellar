import { notFound } from "next/navigation";
import { PassportTiles } from "@/components/dashboard/PassportTiles";
import { VerificationDashboard } from "@/components/dashboard/VerificationDashboard";
import { Card } from "@/components/ui/card";
import { HarnessWallet } from "./HarnessWallet";

export const dynamic = "force-dynamic";

// Lives outside the (dashboard) group so its auth guard and onboarding gate
// do not apply; only servers started with E2E_HARNESS=1 serve it.
export default async function VerificationHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  if (process.env.E2E_HARNESS !== "1") notFound();
  const { screen } = await searchParams;
  return (
    <HarnessWallet>
      {screen === "passport" ? (
        <Card appearance="linen" className="mb-16 gap-0 px-5 py-1 sm:px-8">
          <PassportTiles />
        </Card>
      ) : (
        <VerificationDashboard />
      )}
    </HarnessWallet>
  );
}
