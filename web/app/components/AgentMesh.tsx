/**
 * The thesis, visualized: a Foreman node paying a crew of specialist agents.
 * Coins (USDC) animate along each edge — "agents that hire and pay agents."
 * Pure SVG + SMIL/CSS, no dependencies.
 */
const CREW = [
  { name: "Quill", price: "$0.30", y: 40 },
  { name: "Scout", price: "$0.05", y: 105 },
  { name: "Muse", price: "$0.10", y: 170 },
  { name: "Polish", price: "$0.03", y: 235 },
  { name: "Rank", price: "$0.07", y: 300 },
];

export function AgentMesh() {
  return (
    <svg viewBox="0 0 480 340" className="floaty h-full w-full" role="img" aria-label="Foreman paying a crew of agents">
      {/* edges */}
      {CREW.map((c, i) => (
        <path
          key={`e${i}`}
          id={`edge${i}`}
          d={`M96,170 C230,170 250,${c.y} 392,${c.y}`}
          fill="none"
          stroke="var(--color-edge)"
          strokeWidth="1.5"
        />
      ))}

      {/* traveling coins */}
      {CREW.map((c, i) => (
        <circle key={`c${i}`} r="4.5" fill="var(--color-accent)" className="coin">
          <animateMotion dur="2.2s" begin={`${i * 0.42}s`} repeatCount="indefinite">
            <mpath href={`#edge${i}`} />
          </animateMotion>
        </circle>
      ))}

      {/* crew nodes */}
      {CREW.map((c, i) => (
        <g key={`n${i}`}>
          <circle cx="392" cy={c.y} r="17" fill="var(--color-panel2)" stroke="var(--color-edge)" strokeWidth="1.5" />
          <text x="392" y={c.y + 4} textAnchor="middle" fontSize="10" fill="var(--color-muted)" fontFamily="ui-monospace">
            {c.name[0]}
          </text>
          <text x="416" y={c.y - 2} fontSize="11" fill="var(--color-ink)" fontFamily="ui-sans-serif">
            {c.name}
          </text>
          <text x="416" y={c.y + 11} fontSize="10" fill="var(--color-accent)" fontFamily="ui-monospace">
            {c.price}
          </text>
        </g>
      ))}

      {/* foreman node */}
      <circle cx="70" cy="170" r="34" fill="var(--color-accent)" opacity="0.12" style={{ transformOrigin: "70px 170px", animation: "ring-pulse 2.4s ease-out infinite" }} />
      <circle cx="70" cy="170" r="26" fill="var(--color-panel)" stroke="var(--color-accent)" strokeWidth="2" />
      <text x="70" y="174" textAnchor="middle" fontSize="16" fill="var(--color-accent)">▦</text>
      <text x="70" y="218" textAnchor="middle" fontSize="11" fill="var(--color-ink)" fontFamily="ui-sans-serif">Foreman</text>
    </svg>
  );
}
