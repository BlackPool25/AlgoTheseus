/**
 * components/Layout/BrandLogo.tsx — AlgoTheseus brand mark.
 *
 * Symbolizes the myth of Theseus navigating the Labyrinth of Minos
 * using Ariadne's illuminated golden thread to trace execution paths.
 */

interface BrandLogoProps {
  className?: string;
  size?: number;
}

export function BrandLogo({ className = "w-6 h-6", size = 26 }: BrandLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="theseus-thread-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <filter id="thread-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer Labyrinth Frame */}
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="6"
        fill="#0b0f17"
        stroke="#273244"
        strokeWidth="1.5"
      />

      {/* Labyrinth Walls */}
      <path
        d="M7 25 V11 a4 4 0 0 1 4-4 h10 a4 4 0 0 1 4 4 v14"
        fill="none"
        stroke="#334155"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Ariadne's Golden Execution Thread */}
      <path
        d="M11 25 V15 a2 2 0 0 1 2-2 h6 a2 2 0 0 1 2 2 v10"
        fill="none"
        stroke="url(#theseus-thread-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        filter="url(#thread-glow)"
      />

      {/* Active Step Head (Cyan tracer pulse) */}
      <circle
        cx="21"
        cy="21"
        r="2"
        fill="#38bdf8"
        stroke="#0c1017"
        strokeWidth="0.8"
      />
    </svg>
  );
}
