import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface GrowthTreeProps {
  urgesResisted: number;
  className?: string;
}

interface BranchModule {
  path: string;
  tip: { x: number; y: number };
}

interface LeafNode {
  cx: number;
  cy: number;
  rotation: number;
  scale: number;
}

const TRUNK_PATH = [
  'M 100 212',
  'C 92 186 94 160 100 136',
  'C 106 112 108 82 100 32',
].join(' ');

const TRUNK_ANCHORS = [
  { x: 100, y: 170 },
  { x: 98, y: 148 },
  { x: 102, y: 126 },
  { x: 100, y: 106 },
  { x: 99, y: 86 },
  { x: 101, y: 66 },
  { x: 100, y: 48 },
];

function buildBranchModule(index: number): BranchModule {
  const tier = Math.floor(index / 2);
  const side = index % 2 === 0 ? -1 : 1;

  const startY = Math.max(62, 176 - tier * 14);
  const startX = 100 + side * ((tier % 2) + 1);

  const length = 28 + (tier % 3) * 7;
  const rise = 18 + tier * 2;

  const controlX = startX + side * (length * 0.55);
  const controlY = startY - Math.max(12, rise - 4);

  const endX = startX + side * length;
  const endY = Math.max(18, startY - rise);

  return {
    path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
    tip: { x: endX, y: endY },
  };
}

export function GrowthTree({ urgesResisted, className }: GrowthTreeProps) {
  const normalizedResistCount = Math.max(0, Math.floor(urgesResisted));

  const branches = useMemo(() => {
    const branchCount = Math.floor(normalizedResistCount / 10);
    return Array.from({ length: branchCount }, (_, index) => buildBranchModule(index));
  }, [normalizedResistCount]);

  const leaves = useMemo(() => {
    const leafAnchors = [...TRUNK_ANCHORS, ...branches.map((branch) => branch.tip)];

    return Array.from({ length: normalizedResistCount }, (_, index): LeafNode => {
      const anchor = leafAnchors[index % leafAnchors.length];
      const orbit = Math.floor(index / leafAnchors.length);
      const side = (index + orbit) % 2 === 0 ? -1 : 1;

      const driftX = side * (4 + (orbit % 4) * 1.4);
      const driftY = -2 - (orbit % 5) * 1.6 + ((index % 3) - 1) * 1.2;

      return {
        cx: anchor.x + driftX,
        cy: anchor.y + driftY,
        rotation: side < 0 ? -32 : 32,
        scale: 0.92 + (index % 4) * 0.08,
      };
    });
  }, [branches, normalizedResistCount]);

  return (
    <div className={cn('w-full h-full flex items-center justify-center', className)}>
      <svg
        viewBox="0 0 200 230"
        className="w-full max-w-[320px] h-auto"
        role="img"
        aria-label={`Growth tree with ${normalizedResistCount} leaves and ${branches.length} branches`}
      >
        <path
          d={TRUNK_PATH}
          fill="none"
          stroke="#1A1B1E"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {branches.map((branch, index) => (
          <path
            key={`branch-${index}`}
            d={branch.path}
            fill="none"
            stroke="#E0E0E0"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {leaves.map((leaf, index) => (
          <ellipse
            key={`leaf-${index}`}
            cx={leaf.cx}
            cy={leaf.cy}
            rx={2.8 * leaf.scale}
            ry={4.6 * leaf.scale}
            fill="#76937C"
            transform={`rotate(${leaf.rotation} ${leaf.cx} ${leaf.cy})`}
          />
        ))}
      </svg>
    </div>
  );
}
