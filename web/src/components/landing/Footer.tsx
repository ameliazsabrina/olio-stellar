import { BookText, Github } from "lucide-react";
import Image from "next/image";

const NAV_LINKS = [
  { label: "Docs", href: "https://docs.olio.finance", Icon: BookText },
  { label: "GitHub", href: "https://github.com/olio-finance", Icon: Github },
  { label: "X", href: "https://x.com/olio_finance", Icon: XLogo },
  { label: "Discord", href: "https://discord.gg/olio", Icon: DiscordLogo },
] as const;

export function Footer() {
  return (
    <div className="bg-paper">
      <footer
        className="relative isolate z-20 transform-gpu overflow-hidden rounded-t-[32px] bg-ed-dark text-ed-cream [will-change:transform] sm:rounded-t-[48px]"
        id="footer"
      >
        <div className="absolute inset-0 z-0" aria-hidden="true">
          <Image
            src="/assets/section1-bg.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ed-dark/20 via-ed-dark/60 to-ed-dark" />
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[clamp(150px,22vw,280px)] overflow-hidden select-none"
          aria-hidden="true"
        >
          <div className="absolute inset-x-0 bottom-0 flex translate-y-1/3 justify-center">
            <Image
              src="/assets/olio-white.svg"
              alt=""
              width={640}
              height={640}
              className="h-[clamp(270px,40vw,480px)] w-auto opacity-[0.1]"
            />
          </div>
        </div>

        <div className="relative z-10 flex flex-col justify-end px-[clamp(20px,5vw,72px)] pb-10 pt-[clamp(150px,22vw,280px)]">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-6 border-t border-ed-line pt-8 text-center">
            <nav aria-label="Footer">
              <ul className="flex flex-row flex-wrap items-center justify-center gap-x-8 gap-y-3">
                {NAV_LINKS.map(({ label, href, Icon }) => (
                  <li key={label}>
                    <a
                      className="flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-ed-cream/80 transition-colors duration-150 hover:text-ed-cream focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ed-dark"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <p className="text-xs font-medium text-ed-cream/50">
              © {new Date().getFullYear()} Olio. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18.24 2h3.3l-7.2 8.24L22.8 22h-6.62l-5.18-6.77L4.98 22H1.68l7.7-8.8L1.2 2h6.79l4.68 6.19Zm-1.16 18h1.83L7.02 3.9H5.06Z" />
    </svg>
  );
}

function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19.54 5.34A18.4 18.4 0 0 0 15.04 4c-.2.35-.42.82-.58 1.19a17.1 17.1 0 0 0-4.94 0A12.6 12.6 0 0 0 8.94 4c-1.58.27-3.1.72-4.5 1.34C1.6 9.55.83 13.65 1.22 17.7A18.5 18.5 0 0 0 6.74 20.5c.45-.61.84-1.26 1.18-1.95-.65-.24-1.27-.54-1.84-.9.15-.11.3-.23.44-.35a13.2 13.2 0 0 0 10.96 0l.44.35c-.58.36-1.2.66-1.85.9.34.69.74 1.34 1.18 1.95a18.4 18.4 0 0 0 5.53-2.8c.46-4.7-.78-8.76-3.24-12.36ZM8.68 15.22c-1.08 0-1.97-.99-1.97-2.2 0-1.2.87-2.2 1.97-2.2s1.99 1 1.97 2.2c0 1.21-.87 2.2-1.97 2.2Zm6.64 0c-1.08 0-1.97-.99-1.97-2.2 0-1.2.87-2.2 1.97-2.2s1.99 1 1.97 2.2c0 1.21-.87 2.2-1.97 2.2Z" />
    </svg>
  );
}
