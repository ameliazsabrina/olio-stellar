import { redirect } from "next/navigation";
export default function VerificationPage() {
  redirect("/dashboard?verification=1");
}
