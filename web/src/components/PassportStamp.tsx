// Drawn in currentColor so each surface picks its own ink: the product theme
// remaps --color-gold to linen, which would vanish on a light tile.
export function PassportStampMark({ angle = -12 }: { angle?: number }) {
  return (
    <g transform={`rotate(${angle} 470 276)`}>
      <rect
        x="388"
        y="236"
        width="164"
        height="80"
        rx="16"
        stroke="currentColor"
        strokeDasharray="70 3 40 2 120 4 60 3"
        strokeWidth="2.6"
      />
      <rect
        x="398"
        y="246"
        width="144"
        height="60"
        rx="10"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="1.4"
      />
      <path
        d="M412 277L424 289L444 262"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.2"
      />
      <text
        x="456"
        y="284"
        fill="currentColor"
        className="text-[16px] font-bold"
        lengthAdjust="spacingAndGlyphs"
        textLength="80"
      >
        VERIFIED
      </text>
      <path
        d="M456 296H520"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </g>
  );
}

export function PassportStamp({
  className,
  angle = -12,
}: {
  className?: string;
  angle?: number;
}) {
  // Fit the viewBox to the rotated 164x80 stamp, plus room for its stroke.
  const rad = (Math.abs(angle) * Math.PI) / 180;
  const width = 164 * Math.cos(rad) + 80 * Math.sin(rad) + 6;
  const height = 164 * Math.sin(rad) + 80 * Math.cos(rad) + 6;
  return (
    <svg
      className={className}
      viewBox={`${470 - width / 2} ${276 - height / 2} ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <PassportStampMark angle={angle} />
    </svg>
  );
}
