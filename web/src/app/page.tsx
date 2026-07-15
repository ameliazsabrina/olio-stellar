import { Chrome } from "../components/landing/Chrome";
import { Faq } from "../components/landing/Faq";
import { Footer } from "../components/landing/Footer";
import { Hero } from "../components/landing/Hero";
import { ProblemStatement } from "../components/landing/ProblemStatement";
import { Solution } from "../components/landing/Solution";
import { StellarAcknowledgement } from "../components/landing/StellarAcknowledgement";
import { Steps } from "../components/landing/Steps";
import { Users } from "../components/landing/Users";

export default function Home() {
  return (
    <Chrome>
      <main id="main-content" className="overflow-x-clip">
        <Hero />
        <ProblemStatement />
        <Solution />
        <Steps />
        <Users />
        <StellarAcknowledgement />
        <Faq />
      </main>
      <Footer />
    </Chrome>
  );
}
