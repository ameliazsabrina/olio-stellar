import Image from "next/image";

const USER_CARDS = [
  {
    title: "Freelancers",
    description: "Invoice international clients privately.",
    eyebrow: "Private invoices",
    image: "/assets/freelancer.png",
  },

  {
    title: "Agencies",
    description: "Receive client payments without leaking business activity.",
    eyebrow: "Client payments",
    image: "/assets/agency.png",
  },
  {
    title: "Small Businesses",
    description:
      "Accept stablecoin payments while keeping finances confidential.",
    eyebrow: "Confidential finance",
    image: "/assets/small-business.png",
  },
  {
    title: "Creators",
    description: "Sell digital products without exposing revenue.",
    eyebrow: "Private revenue",
    image: "/assets/creator.png",
  },
] as const;

export function Users() {
  return (
    <section
      className="relative z-20 bg-paper px-[clamp(20px,5vw,72px)] py-8 text-ink sm:py-20"
      id="users"
      data-ed-section
      aria-labelledby="users-title"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="max-w-full">
          <h2
            className="text-balance text-[clamp(2.45rem,5.2vw,4.8rem)] font-semibold leading-[0.94] tracking-[-0.045em] text-ink"
            id="users-title"
          >
            Designed for people who actually earn in crypto.
          </h2>
        </div>

        <div className="mt-14 grid gap-1.5 md:grid-cols-2">
          {USER_CARDS.map((card) => (
            <article
              className="group relative min-h-[360px] overflow-hidden rounded-lg bg-olive-deep text-ed-cream md:min-h-[390px] lg:min-h-[430px]"
              key={card.title}
            >
              <Image
                src={card.image}
                alt=""
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover"
              />
              <div
                className="absolute inset-0 bg-olive-deep/42 mix-blend-multiply"
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(245,243,234,0.18)_0_1px,transparent_1px_8px),linear-gradient(to_bottom,rgba(32,38,26,0.12),rgba(32,38,26,0.74))] opacity-80"
                aria-hidden="true"
              />

              <div className="relative flex min-h-[360px] flex-col justify-between p-7 md:min-h-[390px] lg:min-h-[430px] lg:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ed-cream/78">
                  {card.eyebrow}
                </p>

                <div className="max-w-[360px]">
                  <h3 className="text-balance text-[clamp(2rem,3.2vw,3.35rem)] font-semibold leading-[0.92] tracking-[-0.045em] text-ed-cream">
                    {card.title}
                  </h3>
                  <p className="mt-4 max-w-[31ch] text-base font-medium leading-[1.45] text-ed-cream/82">
                    {card.description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
