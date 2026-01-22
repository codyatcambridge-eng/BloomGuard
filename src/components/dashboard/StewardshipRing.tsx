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
      {/* Outer glow ring */}
      <div className={`absolute w-40 h-40 rounded-full ${isActive ? 'animate-pulse-glow' : ''}`} />
      
      {/* Background ring */}
      <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(210 40% 15%)"
          strokeWidth="4"
        />
        {/* Progress ring */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(180 100% 50%)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000 ease-out"
          style={{
            filter: isActive ? "drop-shadow(0 0 10px hsl(180 100% 50%))" : "none",
          }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute flex flex-col items-center justify-center">
        <Shield 
          className={`w-10 h-10 mb-1 ${isActive ? 'text-aqua' : 'text-muted-foreground'}`}
          style={{
            filter: isActive ? "drop-shadow(0 0 8px hsl(180 100% 50%))" : "none",
          }}
        />
        <span className="text-2xl font-display font-bold text-foreground">
          {percentage}%
        </span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Protected
        </span>
      </div>
    </div>
  );
};
