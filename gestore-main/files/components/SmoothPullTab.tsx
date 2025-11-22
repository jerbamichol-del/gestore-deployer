import React from "react";

type Props = {
  width?: string | number;
  height?: string | number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

/**
 * A smooth pull-tab shape with a uniform color and a pronounced drop shadow for a 3D effect.
 */
export default function SmoothPullTab({
  width = 192,
  height = 64,
  fill = "currentColor",
  stroke = "none",
  strokeWidth = 0,
}: Props) {
  const W = Number(width);
  const H = Number(height);
  const dropShadowFilterId = "smooth-pull-tab-shadow-filter";

  // The path calculation remains the same
  const topPlateauWidth = W * 0.35;
  const bulgeFactor = W * 0.25;
  const x1 = (W - topPlateauWidth) / 2;
  const x2 = x1 + topPlateauWidth;
  const d = [
    `M 0 ${H}`,
    `C ${bulgeFactor} ${H}, ${x1 - bulgeFactor} 0, ${x1} 0`,
    `L ${x2} 0`,
    `C ${x2 + bulgeFactor} 0, ${W - bulgeFactor} ${H}, ${W} ${H}`,
    "Z",
  ].join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Linguetta morbida con effetto rilievo"
      style={{ overflow: 'visible' }} // Allow shadow to render outside the viewbox
    >
      <defs>
        {/* Filter for a more pronounced and directional drop shadow */}
        <filter id={dropShadowFilterId} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow 
                dx="0" 
                dy="-3" 
                stdDeviation="2" 
                floodColor="#475569" // slate-600
                floodOpacity="0.6" 
            />
        </filter>
      </defs>
      
      {/* Apply the shadow filter to the group */}
      <g filter={`url(#${dropShadowFilterId})`}>
        {/* Single path for a uniform color fill */}
        <path
          d={d}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}