"use client";

import Image from "next/image";
import { DropdownMenuItem } from "../../components/ui/dropdown-menu";
import { type CctpChain, EVM_SOURCES, type EvmChainKey } from "../../lib/cctp";

type ChainOption = { chain: CctpChain; label: string; icon?: string };

const ICONS: Partial<Record<CctpChain, string>> = {
  solana: "/assets/sol.png",
  base: "/assets/base.png",
  ethereum: "/assets/eth.png",
};

// The most-used sources lead; the rest follow alphabetically.
const LEADING: EvmChainKey[] = [
  "ethereum",
  "base",
  "arbitrum",
  "avalanche",
  "optimism",
  "polygon",
];

const evmOptions = Object.values(EVM_SOURCES)
  .sort((a, b) => {
    const rank = (key: EvmChainKey) =>
      LEADING.includes(key) ? LEADING.indexOf(key) : LEADING.length;
    return rank(a.key) - rank(b.key) || a.label.localeCompare(b.label);
  })
  .map(
    (source): ChainOption => ({
      chain: source.key,
      label: source.label,
      icon: ICONS[source.key],
    }),
  );

export const CCTP_CHAIN_OPTIONS: ChainOption[] = [
  { chain: "solana", label: "Solana", icon: ICONS.solana },
  ...evmOptions,
];

export function CctpChainMenuItems({
  onSelect,
}: {
  onSelect: (chain: CctpChain) => void;
}) {
  return CCTP_CHAIN_OPTIONS.map((option) => (
    <DropdownMenuItem
      key={option.chain}
      className="min-h-12 cursor-pointer gap-3 px-3 text-brand-linen focus:bg-brand-linen/14 focus:text-brand-linen"
      onClick={() => onSelect(option.chain)}
    >
      {option.icon ? (
        <Image
          src={option.icon}
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-full"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-full bg-brand-linen/15 text-xs font-semibold text-brand-linen ring-1 ring-brand-linen/20"
        >
          {option.label.charAt(0)}
        </span>
      )}
      {option.label}
    </DropdownMenuItem>
  ));
}
