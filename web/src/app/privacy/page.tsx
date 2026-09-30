import { ChevronLeft, Mail } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy | Olio",
  description:
    "Learn how Olio collects, uses, protects, and shares personal data.",
};

const SECTIONS = [
  ["who-we-are", "Who we are"],
  ["scope-and-privacy-limits", "Scope and privacy limits"],
  ["personal-data-we-process", "Personal data we process"],
  ["where-information-comes-from", "Where information comes from"],
  ["purposes-and-legal-bases", "Purposes and legal bases"],
  ["verification-through-sumsub", "Verification through Sumsub"],
  [
    "business-passport-and-public-profiles",
    "Business Passport and public profiles",
  ],
  [
    "public-blockchains-and-payment-privacy",
    "Public blockchains and payment privacy",
  ],
  ["payment-disclosure-exports", "Payment disclosure exports"],
  ["recipients-and-service-providers", "Recipients and service providers"],
  [
    "advertising-and-sale-of-information",
    "Advertising and sale of information",
  ],
  ["international-transfers", "International transfers"],
  ["retention-and-deletion", "Retention and deletion"],
  ["security-and-recovery", "Security and recovery"],
  ["automated-checks-and-review", "Automated checks and review"],
  ["your-rights-and-choices", "Your rights and choices"],
  ["cookies-and-browser-storage", "Cookies and browser storage"],
  ["age-eligibility", "Age eligibility"],
  ["incidents-and-lawful-requests", "Incidents and lawful requests"],
  [
    "indonesian-law-and-other-jurisdictions",
    "Indonesian law and other jurisdictions",
  ],
  ["changes-and-contact", "Changes and contact"],
] as const;

const purposeRows = [
  [
    "Provide accounts, authentication, wallet recovery, and requested payments",
    "Account, wallet, recovery, and payment information",
    "Performance of a contract or requested precontractual steps, where applicable",
  ],
  [
    "Carry out identity/business verification and determine passport eligibility",
    "Verification submissions, results, business relationships, and case records",
    "[IDENTIFY THE BASIS FOR EACH CHECK; CITE ANY APPLICABLE LEGAL OBLIGATION. DO NOT ASSUME ALL KYC IS LEGALLY MANDATED FOR OLIO.]",
  ],
  [
    "Publish a Business Passport at an authorized user's request",
    "The public fields listed in Section 7 and publication evidence",
    "[CONFIRM THE BASIS AND AUTHORITY TO PUBLISH PERSONAL DATA, INCLUDING REPRESENTATIVE OR SOLE-TRADER NAMES]",
  ],
  [
    "Protect accounts, investigate misuse, and maintain security",
    "Relevant account, technical, payment, and verification records",
    "Legitimate interests where recognized and appropriately balanced; legal obligation where specifically applicable",
  ],
  [
    "Respond to support requests and resolve disputes",
    "Communications and relevant service records",
    "Contractual necessity or legitimate interests, as applicable",
  ],
  [
    "Meet accounting, reporting, or other mandatory obligations",
    "Records required by the particular obligation",
    "The applicable legal obligation, identified in our processing and retention records",
  ],
  [
    "Establish, exercise, or defend legal claims",
    "Relevant communications and transaction or account records",
    "An applicable lawful basis and any additional conditions required for protected data",
  ],
  [
    "Run optional analytics, if enabled",
    "The categories stated in the applicable notice",
    "[CONFIRM BASIS AND REQUIRED CONSENT FOR THE ENABLED TECHNOLOGIES]",
  ],
] as const;

const providerRows = [
  [
    "[CONTRACTED PRIVY ENTITY]",
    "Authentication and configured wallet services; identifiers and sign-in information",
    "[CONFIRM]",
    "[CONFIRM]",
  ],
  [
    "[CONTRACTED SUMSUB ENTITY]",
    "Configured KYC/KYB; submissions, technical information, and verification results",
    "[CONFIRM BY PURPOSE]",
    "[CONFIRM]",
  ],
  [
    "[ENABLED PAYMENT / BRIDGE / ANCHOR PROVIDERS]",
    "Selected route; customer information, payment amounts, addresses, and references as required",
    "[CONFIRM]",
    "[CONFIRM]",
  ],
  [
    "[HOSTING, DATABASE, LOGGING, AND SUPPORT PROVIDERS]",
    "Infrastructure, operational records, and support",
    "[CONFIRM]",
    "[CONFIRM]",
  ],
] as const;

const retentionRows = [
  [
    "Account and business membership records",
    "[ACTIVE ACCOUNT PERIOD AND DEFINED POST-CLOSURE PERIOD]",
  ],
  [
    "Verification cases, applicant references, and review metadata",
    "[PERIOD, STARTING EVENT, AND APPLICABLE REQUIREMENT]",
  ],
  [
    "Passport credentials and publication/action audit records",
    "[PERIOD AND STARTING EVENT; DISTINGUISH PUBLIC AVAILABILITY FROM INTERNAL RETENTION]",
  ],
  [
    "Provider-held verification documents and biometric information",
    "[AGREED PROVIDER RETENTION AND DELETION ARRANGEMENT, INCLUDING INDEPENDENT PROCESSING WHERE APPLICABLE]",
  ],
  [
    "Payments, settlement records, and accounting information",
    "[PERIOD AND APPLICABLE REQUIREMENT]",
  ],
  [
    "Encrypted recovery material",
    "[RETENTION AND ACCOUNT-CLOSURE/DELETION RULE]",
  ],
  [
    "Security logs, support records, and processed webhook events",
    "[SEPARATE PERIODS BY CATEGORY]",
  ],
  ["Backups", "[BACKUP EXPIRY CYCLE AND RESTRICTIONS ON RESTORED DATA]"],
] as const;

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-svh bg-paper text-ink">
      <header className="bg-brand-obsidian text-brand-linen">
        <nav
          aria-label="Privacy policy navigation"
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-(--dashboard-gutter) py-5 sm:py-6 lg:py-7"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-linen/12 text-brand-linen ring-1 ring-brand-linen/20 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
              aria-label="Back to dashboard"
              title="Back to dashboard"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
            <span
              className="truncate font-heading text-lg font-semibold text-brand-linen"
              aria-current="page"
            >
              Privacy Policy
            </span>
          </div>
          <Link
            href="/"
            aria-label="Olio home"
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
          >
            <Image
              src="/assets/olio-white.svg"
              alt=""
              width={72}
              height={72}
              className="size-16 sm:size-[4.5rem]"
              priority
            />
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className="border-b border-line text-olive-deep">
          <div className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:px-10 lg:pb-24">
            <h1 className="mt-4 max-w-4xl font-heading text-4xl font-bold tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              Privacy Policy
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-olive-deep sm:text-lg">
              How Olio processes personal data across accounts, payments,
              verification, and Business Passport services.
            </p>
            <dl className="mt-10 flex flex-col gap-4 border-t border-ed-line pt-6 text-sm sm:flex-row sm:gap-12">
              <div>
                <dt className="text-olive/70">Effective date</dt>
                <dd className="mt-1 font-semibold">September 30, 2026</dd>
              </div>
              <div>
                <dt className="text-olive/70">Last updated</dt>
                <dd className="mt-1 font-semibold">September 30, 2026</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-10 lg:py-20">
          <aside className="hidden lg:block">
            <nav
              aria-label="Privacy policy sections"
              className="sticky top-8 border-l border-line pl-5"
            >
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-muted-text">
                On this page
              </p>
              <ol className="space-y-2.5 text-sm leading-5">
                {SECTIONS.map(([id, label], index) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="group flex gap-2 text-muted-text transition-colors duration-150 hover:text-olive-deep"
                    >
                      <span className="w-5 shrink-0 tabular-nums text-olive/70">
                        {index + 1}.
                      </span>
                      <span>{label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="min-w-0 max-w-3xl">
            <PolicySection number={1} id="who-we-are" title="Who we are">
              <p>
                This Privacy Policy explains how{" "}
                <strong>PT PENTAHELIX SISTEM TERPERCAYA</strong>, trading as{" "}
                <strong>Olio / OlioPay</strong> (&quot;Olio,&quot;
                &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), processes
                personal data when you use oliopay.xyz and our related account,
                payment, verification, and Business Passport services (the
                &quot;Services&quot;).
              </p>
              <p>
                The entity responsible for determining the purposes and means of
                the processing described in this Policy is:
              </p>
              <ul>
                <li>
                  <strong>Legal entity:</strong> PT PENTAHELIX SISTEM TERPERCAYA
                </li>
                <li>
                  <strong>Registered address:</strong> Jl. Pondok Kopi Raya No.
                  180, Pondok Kopi Village, Duren Sawit District, East Jakarta
                  Administrative City, DKI Jakarta Province, Postal Code: 13460
                </li>
                <li>
                  <strong>Privacy contact:</strong> <ContactLinks />
                </li>
                <li>
                  <strong>Compliance contact:</strong> <ContactLinks />
                </li>
              </ul>
              <p>
                This Policy describes information processing; it does not itself
                constitute consent to every activity described below. Where
                consent is required, we request it through the relevant flow.
              </p>
            </PolicySection>

            <PolicySection
              number={2}
              id="scope-and-privacy-limits"
              title="Scope and privacy limits"
            >
              <p>
                The information we process depends on the features you use, your
                account type, and the services available in your location. A
                description of a payment route or provider does not mean that
                route is available to every user.
              </p>
              <p>
                Olio uses privacy technologies to reduce unnecessary public
                exposure of payment information. These technologies do not
                guarantee anonymity or prevent all links between accounts,
                identities, and transactions. Information visible to Olio or a
                service provider can differ from information visible on a public
                blockchain.
              </p>
              <p>
                The current Business Passport provides identity-verification
                status. This Policy does not describe an available revenue
                score, credit rating, business-quality grade, or portable
                cryptographically signed financial credential. Before
                introducing additional uses of personal data for such products,
                we will provide the relevant information and obtain consent
                where required.
              </p>
            </PolicySection>

            <PolicySection
              number={3}
              id="personal-data-we-process"
              title="Personal data we process"
            >
              <Subsection title="Account and authentication information">
                <p>
                  We process account identifiers, usernames, authentication and
                  session information, and contact details supplied through your
                  selected sign-in method or directly to us. We also process
                  business membership and permission information, such as
                  whether an account is a business owner or administrator.
                </p>
              </Subsection>
              <Subsection title="Identity and business verification information">
                <p>
                  When you undertake KYC or KYB verification, the configured
                  process may require names, dates of birth, nationality,
                  addresses, government identification details,
                  identity-document images, proof of address, business
                  registration details, business activities, and information
                  about representatives, directors, controllers, or beneficial
                  owners.
                </p>
                <p>
                  Sumsub collects and processes verification submissions through
                  the configured verification flow. Olio receives and stores
                  verification metadata, including applicant and case
                  identifiers, status, check timestamps, rejection labels,
                  associated-person references and roles, and moderation
                  comments. Free-text comments may contain personal information.
                  Our integration may also receive applicant information while
                  retrieving and interpreting verification results, even when
                  only a smaller set of fields is retained in our operational
                  records.
                </p>
                <p>
                  Documents and selfies submitted through Sumsub are handled in
                  its verification environment. This does not mean that Olio
                  receives only a yes/no result or can never process information
                  contained in a verification case.
                </p>
              </Subsection>
              <Subsection title="Facial verification and biometric information">
                <p>
                  Where the selected verification process requires facial
                  matching or liveness checks, Sumsub may process selfies,
                  facial images, video, and derived facial or biometric
                  information as described in the notices presented during
                  verification. The information collected depends on the
                  configured checks.
                </p>
                <p>
                  Olio does not use verification documents or biometric
                  information for advertising. Where separate consent is
                  required for biometric processing, it must be obtained before
                  that processing begins. Required notices explain the relevant
                  purposes and parties involved.
                </p>
              </Subsection>
              <Subsection title="Verification, fraud, and compliance records">
                <p>
                  We process verification outcomes, review history, credential
                  eligibility, suspensions, screening indicators returned by
                  enabled checks, and audit records of relevant actions. We may
                  request additional information when necessary to resolve a
                  verification issue, investigate suspected misuse, or meet an
                  applicable obligation.
                </p>
                <p>
                  An automated flag or screening match does not by itself
                  establish wrongdoing. Not every screening or
                  transaction-monitoring product offered by a provider is
                  necessarily enabled for Olio.
                </p>
              </Subsection>
              <Subsection title="Wallet, payment, and blockchain information">
                <p>
                  Depending on the payment route, we process public addresses
                  and keys, account or username references, transaction hashes,
                  assets, amounts, timestamps, commitments, payment references,
                  recipient information, fee quotes, payment status, settlement
                  information, and related cryptographic data.
                </p>
                <p>
                  Fiat payment or bridge services may require additional
                  customer information, such as contact details, and may
                  generate records linking a user or username with a payment
                  amount and transaction reference. Some session information is
                  encrypted in storage but can be decrypted by Olio&apos;s
                  service to operate the transaction.
                </p>
              </Subsection>
              <Subsection title="Wallet recovery and device storage">
                <p>
                  For the supported recovery flow, Olio stores an encrypted
                  wallet recovery master together with the salt and
                  key-derivation parameters needed for recovery. The application
                  uses your recovery credentials to perform the relevant
                  cryptographic operations. Encrypted recovery material is still
                  sensitive information.
                </p>
                <p>
                  The application also stores wallet owner and viewing secrets
                  in browser local storage for wallet functionality. Those
                  stored values are usable secret material and are not all
                  protected by an additional application-level encryption layer.
                  Browser storage may also contain preferences and cached wallet
                  information.
                </p>
              </Subsection>
              <Subsection title="Business Passport information">
                <p>
                  We process the business profile, authorized members,
                  verification case references, credential status, publication
                  choices, and related audit records. The public fields are
                  described in Section 7.
                </p>
              </Subsection>
              <Subsection title="Technical and support information">
                <p>
                  We process technical information necessary for authentication,
                  request handling, security, and troubleshooting, which can
                  include IP addresses, browser or device information, session
                  information, timestamps, and error records. We also process
                  messages, attachments, and contact details you provide when
                  requesting support or reporting an issue.
                </p>
                <ReviewText>
                  [CONFIRM THE PRODUCTION LOGGING AND ANALYTICS INVENTORY;
                  IDENTIFY ANY OPTIONAL ANALYTICS DATA AND PROVIDERS BEFORE
                  PUBLICATION.]
                </ReviewText>
              </Subsection>
            </PolicySection>

            <PolicySection
              number={4}
              id="where-information-comes-from"
              title="Where information comes from"
            >
              <p>
                We receive information from you, authorized business members,
                payment counterparties, authentication and verification
                providers, payment providers, and blockchain networks.
                Verification providers may consult public registers and
                screening sources as part of enabled checks.
              </p>
              <p>
                If you submit personal information about a representative,
                director, beneficial owner, or another person, you must have
                appropriate authority or another lawful basis to provide it and
                give them the relevant privacy information. This does not remove
                Olio&apos;s own responsibility to provide notices where
                required.
              </p>
            </PolicySection>

            <PolicySection
              number={5}
              id="purposes-and-legal-bases"
              title="Purposes and legal bases"
            >
              <p>
                We use personal data for defined purposes and rely on the basis
                applicable to the activity and jurisdiction. We do not treat
                consent as the basis for all processing or describe fraud
                prevention itself as a separate legal basis.
              </p>
              <PolicyTable
                headers={[
                  "Purpose",
                  "Data involved",
                  "Applicable basis to be confirmed for publication",
                ]}
                rows={purposeRows}
              />
              <p>
                Sensitive or specially protected information may require
                additional conditions or explicit consent. We identify those
                conditions before the relevant processing. We do not use a
                general acceptance of this Policy as a substitute.
              </p>
            </PolicySection>

            <PolicySection
              number={6}
              id="verification-through-sumsub"
              title="Verification through Sumsub"
            >
              <p>
                Olio integrates with Sumsub for the identity and business
                verification checks configured for the relevant product. The
                verification flow identifies the information required and
                presents the relevant notices and consents before submission.
              </p>
              <p>
                For processing undertaken on Olio&apos;s instructions, the
                respective responsibilities are governed by our agreement with
                the provider. Sumsub may also act as an independent controller
                for particular processing described in its applicable notice.
                Its role is not necessarily the same for every purpose.
              </p>
              <p>
                Read the{" "}
                <a
                  href="https://sumsub.com/privacy-notice-service/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Sumsub Service Delivery Privacy Notice
                </a>{" "}
                and any additional notices presented during verification.{" "}
                <strong>
                  [CONFIRM THIS NOTICE MATCHES THE CONTRACTED SUMSUB ENTITY AND
                  SERVICES.]
                </strong>
              </p>
              <p>
                Sumsub&apos;s SDK handles provider consent collection within its
                supported flow. Olio remains responsible for its own applicable
                transparency and consent requirements. Where required,
                additional notices or consent are presented separately.
                Acceptance records must be available to demonstrate the relevant
                choices.
              </p>
              <p>
                If you decline information or consent necessary for a particular
                check, that check may not be completed and the associated
                feature or passport may be unavailable. This does not
                automatically mean that every Olio service is unavailable.
              </p>
            </PolicySection>

            <PolicySection
              number={7}
              id="business-passport-and-public-profiles"
              title="Business Passport and public profiles"
            >
              <p>
                The current Business Passport is an Olio-issued
                identity-verification status displayed through a hosted public
                page. Sumsub performs configured checks; Olio applies its
                credential policy to determine eligibility.
              </p>
              <p>
                An authorized owner or administrator can choose to publish an
                eligible passport. The public response contains:
              </p>
              <ul>
                <li>
                  The profile&apos;s public identifier and display name, if
                  supplied.
                </li>
                <li>
                  Whether the profile represents an individual or a company.
                </li>
                <li>
                  Its verified status, issuer, and identity-verification scope.
                </li>
                <li>
                  The credential policy version, verification date, and expiry
                  date.
                </li>
              </ul>
              <p>
                The public response does not include identity documents,
                selfies, provider rejection reasons, private transaction
                history, or wallet recovery secrets.
              </p>
              <p>
                A published page is accessible to anyone with its link.
                Search-engine exclusion does not make it access-controlled.
                Recipients may copy, screenshot, retain, or redistribute
                information they receive.
              </p>
              <p>
                Eligibility is reassessed over time. A passport may become
                unavailable when unpublished, suspended, stale, or expired.
                Unpublishing removes public availability through Olio&apos;s
                passport response; it does not delete internal verification
                records or remove copies already held by others.
              </p>
              <p>
                The passport does not certify revenue, transaction volume,
                independent customers, creditworthiness, business quality, or
                general legal compliance. Publishing it does not authorize
                publication of the business&apos;s entire financial history.
              </p>
            </PolicySection>

            <PolicySection
              number={8}
              id="public-blockchains-and-payment-privacy"
              title="Public blockchains and payment privacy"
            >
              <p>
                Public blockchain records are replicated by independent network
                participants. Olio cannot generally erase, amend, or control
                their copies.
              </p>
              <p>
                Depending on the route and contract operation, public
                information can include addresses, registered public keys or
                identifiers, deposits, withdrawals, amounts, transaction hashes,
                timestamps, commitments, fees, and contract events. Certain
                payment-fee events contain payer and amount information. Other
                information may become linkable through timing, payment
                references, or data held by counterparties.
              </p>
              <p>
                Privacy mechanisms can reduce particular links between
                transactions but do not conceal every amount or all activity.
                Olio and enabled payment providers may hold off-chain records
                that connect accounts or business information with transactions.
              </p>
              <p>
                Do not add identification numbers, private keys, recovery
                credentials, or unnecessary personal information to public
                transaction fields. Ordinary identity verification does not
                require you to give Olio or Sumsub your wallet seed phrase or
                private key.
              </p>
            </PolicySection>

            <PolicySection
              number={9}
              id="payment-disclosure-exports"
              title="Payment disclosure exports"
            >
              <p>
                When you choose to export a payment disclosure, the current
                bundle includes the exact payment amount, commitment, owner
                public key, salt, Merkle proof information, pool and network
                identifiers, disclosure timestamp, and a username if included.
              </p>
              <p>
                These fields allow a recipient to inspect the disclosed payment
                information and can link the disclosure with other records. This
                export is not an amount-hiding proof that merely confirms a
                threshold, and it is not a guarantee that the recipient cannot
                infer additional information.
              </p>
              <p>
                Share disclosures only with recipients you intend to receive
                them. A recipient can retain or redistribute a downloaded
                export. Olio cannot revoke copies already received. The bundle
                does not contain the wallet owner secret or recovery master.
              </p>
            </PolicySection>

            <PolicySection
              number={10}
              id="recipients-and-service-providers"
              title="Recipients and service providers"
            >
              <p>
                We share information necessary for the relevant service or
                lawful purpose with:
              </p>
              <ul>
                <li>
                  Authentication and wallet providers, including Privy for the
                  configured authentication services.
                </li>
                <li>Sumsub for configured verification services.</li>
                <li>
                  Payment, bridge, settlement, or anchor providers involved in
                  the route you select.
                </li>
                <li>
                  Hosting, database, infrastructure, security, and support
                  providers used to operate the Services.
                </li>
                <li>
                  Professional advisers where necessary for legal, accounting,
                  audit, or compliance work.
                </li>
                <li>
                  Authorities where disclosure is required or otherwise lawfully
                  justified.
                </li>
                <li>
                  Parties involved in a proposed business transfer, subject to
                  appropriate confidentiality, legal basis, and required
                  notices.
                </li>
              </ul>
              <p>
                Public passport viewers and people to whom you send disclosure
                exports also receive information as described above.
              </p>
              <p>
                The following provider schedule must accurately identify the
                production arrangements:
              </p>
              <PolicyTable
                headers={[
                  "Provider / legal entity",
                  "Purpose and relevant data",
                  "Role",
                  "Processing locations and transfer safeguards",
                ]}
                rows={providerRows}
              />
              <p>
                Third parties acting independently may process information under
                their own notices. Their independent role does not remove
                Olio&apos;s responsibility for disclosures or processing under
                Olio&apos;s control.
              </p>
            </PolicySection>

            <PolicySection
              number={11}
              id="advertising-and-sale-of-information"
              title="Advertising and sale of information"
            >
              <p>
                Olio does not sell personal data for monetary consideration or
                use KYC documents, biometric information, private payment
                records, or non-public financial history for third-party
                behavioral advertising.
              </p>
              <ReviewText>
                [VALIDATE THIS STATEMENT AGAINST THE PRODUCTION SDK, ANALYTICS,
                AND COMMERCIAL INVENTORY BEFORE PUBLICATION.]
              </ReviewText>
            </PolicySection>

            <PolicySection
              number={12}
              id="international-transfers"
              title="International transfers"
            >
              <p>
                Providers and infrastructure may process information outside
                your country. The schedule in Section 10 identifies the relevant
                locations and safeguards.
              </p>
              <p>
                For transfers subject to Indonesian personal-data law, we assess
                the recipient country&apos;s level of protection and, where that
                requirement is not met, the availability of adequate and binding
                safeguards. Where the preceding requirements cannot be met, the
                applicable consent requirements must be addressed before
                transfer. These are not interchangeable options chosen without
                assessment.
              </p>
              <p>
                Where another transfer regime applies, we use its required
                mechanism and provide additional information as required. You
                can request information about applicable safeguards through the
                privacy contact.
              </p>
            </PolicySection>

            <PolicySection
              number={13}
              id="retention-and-deletion"
              title="Retention and deletion"
            >
              <p>
                We retain personal data for the period necessary for its stated
                purpose and any applicable, identified legal obligations.
                Retention is determined by category and trigger, rather than by
                an indefinite general need for compliance.
              </p>
              <PolicyTable
                headers={[
                  "Record category",
                  "Retention period or specific criterion",
                ]}
                rows={retentionRows}
              />
              <p>
                If a specific legal hold requires longer retention, we limit it
                to the affected records and retain them for the applicable
                purpose and duration. Once retention is no longer justified, we
                delete or effectively anonymize the relevant information
                according to the applicable process.
              </p>
              <p>
                Unpublishing or suspending a passport does not itself delete
                verification data. Deletion requests are assessed across
                Olio&apos;s records and information processed on our behalf by
                providers. Provider-independent processing may require a
                separate request or explanation of the provider&apos;s
                obligations.
              </p>
              <p>
                Public blockchain records and copies independently retained by
                disclosure recipients are not generally deletable by Olio. We
                explain these limits when responding to relevant requests.
              </p>
            </PolicySection>

            <PolicySection
              number={14}
              id="security-and-recovery"
              title="Security and recovery"
            >
              <p>
                We use safeguards appropriate to the systems and information
                involved. The architecture includes encrypted recovery records
                and encrypted fields for some payment-session information, but
                this does not mean that every record is encrypted in every
                location or inaccessible to Olio.
              </p>
              <p>
                No online service, device, or cryptographic system guarantees
                absolute security. Protect your device, browser profile,
                authentication access, and recovery credentials. Clearing
                browser storage or deleting recovery information can affect
                access to wallet functionality; confirm that you have an
                appropriate recovery method before doing so.
              </p>
              <ReviewText>
                [CONFIRM IMPLEMENTED ACCESS CONTROLS, SECURITY PROCEDURES, AND
                RECOVERY INSTRUCTIONS BEFORE PUBLICATION.]
              </ReviewText>
            </PolicySection>

            <PolicySection
              number={15}
              id="automated-checks-and-review"
              title="Automated checks and review"
            >
              <p>
                Configured verification processes use automated checks, which
                may include document checks, facial matching, liveness, and
                screening. Olio also applies credential eligibility rules based
                on verification results and their freshness. These can prevent
                publication, require further information, or make an existing
                passport unavailable.
              </p>
              <p>
                If you believe a result or restriction is incorrect, contact{" "}
                <ContactLinks />. We will assess the request and provide the
                review and challenge mechanisms required by applicable law. A
                flag or failed check is not a public finding that you committed
                wrongdoing.
              </p>
            </PolicySection>

            <PolicySection
              number={16}
              id="your-rights-and-choices"
              title="Your rights and choices"
            >
              <p>
                Depending on applicable law, you may request information about
                processing, access, correction, deletion, restriction,
                portability, withdrawal of consent, or objection to certain
                processing. You may also have rights concerning decisions based
                solely on automated processing and the right to complain to a
                competent authority.
              </p>
              <p>
                Send requests to <ContactLinks />. We may ask for proportionate
                information to verify your identity or authority to act for a
                business. We respond within the applicable legal period and
                explain any lawful limitations or retained categories.
              </p>
              <p>
                Where processing relies on consent, you can withdraw that
                consent through the relevant control or by contacting us.
                Withdrawal does not invalidate prior lawful processing. It may
                affect the feature requiring that consent. Continued processing
                requires an independently applicable lawful basis; withdrawing
                consent is not a blanket authorization for indefinite retention.
              </p>
              <p>
                You can request that a passport be unpublished separately from
                requesting deletion of personal data.
              </p>
            </PolicySection>

            <PolicySection
              number={17}
              id="cookies-and-browser-storage"
              title="Cookies and browser storage"
            >
              <p>
                The Services use authentication/session technologies and browser
                storage for account and wallet functionality. Wallet storage
                includes the secrets described in Section 3, so its consequences
                extend beyond ordinary website preferences.
              </p>
              <p>
                Optional analytics or other non-essential technologies, if
                enabled, are described in the relevant notice and require
                consent where applicable. Browser controls may remove stored
                information, but doing so can sign you out or affect wallet
                access.
              </p>
              <p>
                <strong>Storage notice and preferences:</strong> [PUBLISHED
                NOTICE / SETTINGS LINK WITH ACTUAL TECHNOLOGIES, PURPOSES,
                PROVIDERS, AND LIFETIMES]
              </p>
            </PolicySection>

            <PolicySection
              number={18}
              id="age-eligibility"
              title="Age eligibility"
            >
              <p>
                The Services are intended for users aged 18 or older. If you
                believe a child has provided personal data through the Services,
                contact us so we can assess the information and take appropriate
                action.
              </p>
              <ReviewText>
                [CONFIRM THIS AGE RULE MATCHES THE TERMS, SUPPORTED MARKETS, AND
                ONBOARDING CONTROLS.]
              </ReviewText>
            </PolicySection>

            <PolicySection
              number={19}
              id="incidents-and-lawful-requests"
              title="Incidents and lawful requests"
            >
              <p>
                We investigate personal-data incidents and provide notifications
                required by applicable law within the applicable deadlines. For
                incidents subject to Article 46 of Indonesia&apos;s Personal
                Data Protection Law, this includes the applicable written
                notification requirement within 3 × 24 hours. Our incident
                procedures must account for the relevant recipients, content,
                and any applicable exceptions.
              </p>
              <p>
                We assess official requests for their legal basis, authority,
                and scope, and limit disclosures as required by law. Where
                legally permitted and appropriate, we provide notice. Some
                investigations or legal obligations may restrict what we can
                disclose about a request.
              </p>
            </PolicySection>

            <PolicySection
              number={20}
              id="indonesian-law-and-other-jurisdictions"
              title="Indonesian law and other jurisdictions"
            >
              <p>
                Where Indonesia&apos;s Law No. 27 of 2022 concerning Personal
                Data Protection applies, our processing is subject to its
                requirements, including those concerning specific personal data,
                rights, security, accountability, and international transfers.
                Biometric and personal financial information require particular
                attention under that law.
              </p>
              <p>
                We conduct a data-protection impact assessment where required
                for high-risk processing. We also assess whether appointment of
                a data protection officer or another designated contact is
                required.
              </p>
              <p>
                If additional jurisdiction-specific notices or rights apply, we
                provide the necessary information for those services and users.
                This Policy does not itself establish that Olio offers services
                in the EEA, United Kingdom, United States, or every other
                jurisdiction.
              </p>
            </PolicySection>

            <PolicySection
              number={21}
              id="changes-and-contact"
              title="Changes and contact"
            >
              <p>
                We update this Policy when our processing changes and revise the
                date above. Where required, we provide advance or additional
                notice and obtain new consent before the relevant change takes
                effect.
              </p>
              <p>For questions, requests, or complaints, contact:</p>
              <address className="not-italic">
                <strong>Olio Privacy Team</strong>
                <br />
                PT PENTAHELIX SISTEM TERPERCAYA
                <br />
                Jl. Pondok Kopi Raya No. 180, Pondok Kopi Village, Duren Sawit
                District, East Jakarta Administrative City, DKI Jakarta
                Province, Postal Code: 13460
                <br />
                <ContactLinks />
              </address>
              <p>
                You may also contact the competent data-protection authority
                where applicable law provides that right.
              </p>
            </PolicySection>

            <div className="mt-16 border-t border-line pt-8">
              <a
                href="mailto:olio@olipay.xyz"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-olive px-5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-olive-deep hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
              >
                <Mail className="size-4" aria-hidden="true" />
                Contact the privacy team
              </a>
            </div>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function PolicySection({
  number,
  id,
  title,
  children,
}: {
  number: number;
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-8 border-t border-line py-10 first-of-type:mt-12 sm:py-12"
    >
      <div className="mb-6 flex items-start gap-4">
        <span className="mt-1 text-sm font-bold tabular-nums text-gold">
          {String(number).padStart(2, "0")}
        </span>
        <h2 className="font-heading text-2xl font-bold tracking-[-0.025em] text-ink sm:text-3xl">
          {title}
        </h2>
      </div>
      <div className="space-y-5 text-[0.97rem] leading-7 text-ink/80 [&_a]:font-semibold [&_a]:underline [&_a]:decoration-olive/35 [&_a]:underline-offset-4 hover:[&_a]:decoration-olive-deep [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}

function Subsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 pt-2">
      <h3 className="text-lg font-bold tracking-[-0.015em] text-ink">
        {title}
      </h3>
      {children}
    </div>
  );
}

function DraftNote({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 border-l-2 border-gold bg-gold/10 px-5 py-4 text-sm leading-6 text-ink/75">
      {children}
    </div>
  );
}

function ReviewText({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-gold pl-4 font-semibold text-ink">
      {children}
    </p>
  );
}

function ContactLinks() {
  return (
    <>
      <a href="mailto:ptpentahelixsistemterpercaya@gmail.com">
        ptpentahelixsistemterpercaya@gmail.com
      </a>{" "}
      / <a href="mailto:olio@olipay.xyz">olio@olipay.xyz</a>
    </>
  );
}

function PolicyTable({
  headers,
  rows,
}: {
  headers: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
}) {
  return (
    <div className="my-7 overflow-x-auto border-y border-line">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm leading-6">
        <thead>
          <tr className="bg-sage/70">
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="border-b border-line px-4 py-3 font-bold text-ink"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[0]}
              className="border-b border-line-soft last:border-b-0"
            >
              {row.map((cell, index) => (
                <td
                  key={`${row[0]}-${headers[index]}`}
                  className="align-top px-4 py-3 text-ink/75 first:font-semibold first:text-ink"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
