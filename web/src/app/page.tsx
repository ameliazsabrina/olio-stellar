"use client";

import { Dashboard } from "../components/dashboard/Dashboard";
import { Chrome } from "../components/landing/Chrome";
import { Faq } from "../components/landing/Faq";
import { Footer } from "../components/landing/Footer";
import { Hero } from "../components/landing/Hero";
import { ProblemStatement } from "../components/landing/ProblemStatement";
import { Solution } from "../components/landing/Solution";
import { StellarAcknowledgement } from "../components/landing/StellarAcknowledgement";
import { Steps } from "../components/landing/Steps";
import { Users } from "../components/landing/Users";
import { useWallet } from "../components/WalletProvider";

export default function Home() {
  const { address, username, usernameResolved } = useWallet();

  if (address && !usernameResolved) {
    return <div className="min-h-svh bg-paper" />;
  }
  if (address && username) {
    return <Dashboard />;
  }

  return (
    <Chrome>
      <Hero />
      <ProblemStatement />
      <Solution />
      <Steps />
      <Users />
      <StellarAcknowledgement />
      <Faq />
      <Footer />
    </Chrome>
  );
}
