import { Chrome } from "../components/landing/Chrome";
import { Faq } from "../components/landing/Faq";
import { Footer } from "../components/landing/Footer";
import { Hero } from "../components/landing/Hero";
import { Passport } from "../components/landing/Passport";
import { Pricing } from "../components/landing/Pricing";
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
        <Passport />
        <Users />
        <Pricing />
        <StellarAcknowledgement />
        <Faq />
      </main>
      <Footer />
    </Chrome>
  );
}
