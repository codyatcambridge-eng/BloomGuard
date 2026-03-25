import { Shield } from "lucide-react";

interface StewardshipRingProps {
  percentage: number;
  isActive: boolean;
}

export const StewardshipRing = ({ percentage, isActive }: StewardshipRingProps) => {
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center">
      {/* Outer atmospheric glow */}
      <div 
        className={`absolute w-48 h-48 rounded-full ${isActive ? 'animate-pulse-glow' : ''}`}
        style={{
          background: isActive 
            ? 'radial-gradient(circle, hsl(180 100% 50% / 0.15) 0%, transparent 70%)'
            : 'none',
        }}
      />
      
      {/* Background ring with silver edge */}
      <svg className="w-44 h-44 transform -rotate-90" viewBox="0 0 100 100">
        {/* Outer silver ring */}
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="none"
          stroke="hsl(220 10% 40% / 0.3)"
          strokeWidth="1"
        />
        {/* Dark background track */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(220 40% 10%)"
          strokeWidth="6"
        />
        {/* Progress ring - high contrast aqua */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(180 100% 50%)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000 ease-out"
          style={{
            filter: isActive 
              ? "drop-shadow(0 0 15px hsl(180 100% 50%)) drop-shadow(0 0 30px hsl(180 100% 50% / 0.5))" 
              : "none",
          }}
        />
        {/* Inner silver ring */}
        <circle
          cx="50"
          cy="50"
          r="38"
          fill="none"
          stroke="hsl(220 10% 35% / 0.2)"
          strokeWidth="1"
        />
      </svg>

      {/* Center content with silver tablet effect */}
      <div 
        className="absolute flex flex-col items-center justify-center w-28 h-28 rounded-full"
        style={{
          background: 'linear-gradient(145deg, hsl(220 40% 12%) 0%, hsl(220 50% 8%) 100%)',
          boxShadow: 'inset 0 2px 4px hsl(220 10% 30% / 0.2), 0 4px 20px hsl(220 100% 3% / 0.5)',
          border: '1px solid hsl(220 10% 35% / 0.3)',
        }}
      >
        <Shield 
          className={`w-10 h-10 mb-1 ${isActive ? 'text-aqua' : 'text-muted-foreground'}`}
          style={{
            filter: isActive 
              ? "drop-shadow(0 0 12px hsl(180 100% 50%)) drop-shadow(0 0 20px hsl(180 100% 50% / 0.6))" 
              : "none",
          }}
        />
        <span 
          className="text-3xl font-display font-bold"
          style={{
            color: isActive ? 'hsl(180 100% 50%)' : 'hsl(0 0% 100%)',
            textShadow: isActive ? '0 0 20px hsl(180 100% 50% / 0.8)' : 'none',
          }}
        >
          {percentage}%
        </span>
        <span className="text-xs text-silver uppercase tracking-wider">
          Protected
        </span>
      </div>
    </div>
  );
};
