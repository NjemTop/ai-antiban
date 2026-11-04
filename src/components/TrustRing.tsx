import React from "react";

interface TrustRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
}

export const TrustRing: React.FC<TrustRingProps> = ({
  score,
  size = 52,
  strokeWidth = 3.5,
}) => {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

  let colorClass = "stroke-emerald-400 text-emerald-400";
  let bgGlow = "shadow-emerald-500/10";
  if (clampedScore < 36) {
    colorClass = "stroke-rose-500 text-rose-400";
    bgGlow = "shadow-rose-500/10";
  } else if (clampedScore < 86) {
    colorClass = "stroke-amber-400 text-amber-400";
    bgGlow = "shadow-amber-500/10";
  }

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${bgGlow}`}
      style={{ width: size, height: size }}
    >
      <svg
        className="-rotate-90 transform"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-white/[0.08]"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={`${colorClass} transition-all duration-700 ease-out`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
        />
      </svg>
      {/* Central Score */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[13px] font-bold tracking-tighter text-white tabular-nums">
          {clampedScore}
        </span>
        <span className="text-[7.5px] uppercase tracking-wider text-zinc-500 font-mono -mt-0.5">
          Trust
        </span>
      </div>
    </div>
  );
};
