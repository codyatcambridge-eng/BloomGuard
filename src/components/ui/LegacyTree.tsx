import { cn } from "@/lib/utils";

interface LegacyTreeProps {
  size?: "small" | "medium" | "large" | "hero";
  glowIntensity?: "low" | "medium" | "high";
  className?: string;
}

/**
 * Legacy Tree - An animated, luminous tree representing growth and progress.
 * Uses CSS for subtle sway and glow animations.
 * Respects prefers-reduced-motion for accessibility.
 */
export const LegacyTree = ({ 
  size = "medium",
  glowIntensity = "medium",
  className 
}: LegacyTreeProps) => {
  const sizeStyles = {
    small: "w-32 h-32",
    medium: "w-48 h-48",
    large: "w-64 h-64",
    hero: "w-[85vw] h-[85vw] max-w-[400px] max-h-[400px]",
  };

  const glowStyles = {
    low: "opacity-30",
    medium: "opacity-50",
    high: "opacity-70",
  };

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Glow effect behind the tree */}
      <div 
        className={cn(
          "absolute rounded-full blur-3xl animate-glow-pulse",
          sizeStyles[size],
          glowStyles[glowIntensity]
        )}
        style={{
          background: "radial-gradient(circle, hsl(45 100% 50% / 0.4) 0%, hsl(80 60% 40% / 0.2) 50%, transparent 70%)"
        }}
      />
      
      {/* Tree SVG */}
      <svg 
        viewBox="0 0 200 240" 
        className={cn(sizeStyles[size], "relative z-10 animate-sway")}
        style={{ filter: "drop-shadow(0 0 15px hsl(45 100% 50% / 0.5))" }}
      >
        {/* Tree trunk */}
        <path 
          d="M95 180 L95 220 Q100 225 105 220 L105 180 Q100 175 95 180"
          fill="url(#trunkGradient)"
        />
        
        {/* Tree roots */}
        <path 
          d="M85 220 Q90 225 95 220 M105 220 Q110 225 115 220 M75 218 Q85 222 90 218 M110 218 Q115 222 125 218"
          stroke="hsl(30 50% 25%)"
          strokeWidth="2"
          fill="none"
        />
        
        {/* Main foliage layers - bottom */}
        <ellipse cx="100" cy="140" rx="55" ry="40" fill="url(#foliageGradient3)" className="animate-shimmer" />
        
        {/* Middle layer */}
        <ellipse cx="100" cy="110" rx="48" ry="35" fill="url(#foliageGradient2)" className="animate-shimmer" style={{ animationDelay: "0.5s" }} />
        
        {/* Top layer */}
        <ellipse cx="100" cy="80" rx="38" ry="30" fill="url(#foliageGradient1)" className="animate-shimmer" style={{ animationDelay: "1s" }} />
        
        {/* Crown */}
        <ellipse cx="100" cy="55" rx="25" ry="20" fill="url(#crownGradient)" className="animate-shimmer" style={{ animationDelay: "1.5s" }} />
        
        {/* Light particles / leaves */}
        <g className="animate-shimmer">
          <circle cx="75" cy="95" r="2" fill="hsl(50 100% 70%)" opacity="0.8" />
          <circle cx="125" cy="100" r="1.5" fill="hsl(50 100% 75%)" opacity="0.7" />
          <circle cx="90" cy="70" r="1.5" fill="hsl(50 100% 70%)" opacity="0.9" />
          <circle cx="115" cy="130" r="2" fill="hsl(50 100% 65%)" opacity="0.6" />
          <circle cx="80" cy="125" r="1.5" fill="hsl(50 100% 70%)" opacity="0.7" />
          <circle cx="110" cy="75" r="1" fill="hsl(55 100% 80%)" opacity="0.8" />
        </g>
        
        {/* Gradients definitions */}
        <defs>
          <linearGradient id="trunkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(30 50% 30%)" />
            <stop offset="50%" stopColor="hsl(30 45% 22%)" />
            <stop offset="100%" stopColor="hsl(30 40% 18%)" />
          </linearGradient>
          
          <radialGradient id="foliageGradient1" cx="50%" cy="30%">
            <stop offset="0%" stopColor="hsl(55 100% 55%)" />
            <stop offset="50%" stopColor="hsl(70 80% 40%)" />
            <stop offset="100%" stopColor="hsl(90 70% 30%)" />
          </radialGradient>
          
          <radialGradient id="foliageGradient2" cx="50%" cy="30%">
            <stop offset="0%" stopColor="hsl(65 90% 50%)" />
            <stop offset="50%" stopColor="hsl(80 75% 38%)" />
            <stop offset="100%" stopColor="hsl(100 65% 28%)" />
          </radialGradient>
          
          <radialGradient id="foliageGradient3" cx="50%" cy="30%">
            <stop offset="0%" stopColor="hsl(75 85% 45%)" />
            <stop offset="50%" stopColor="hsl(90 70% 35%)" />
            <stop offset="100%" stopColor="hsl(110 60% 25%)" />
          </radialGradient>
          
          <radialGradient id="crownGradient" cx="50%" cy="30%">
            <stop offset="0%" stopColor="hsl(50 100% 60%)" />
            <stop offset="50%" stopColor="hsl(60 90% 48%)" />
            <stop offset="100%" stopColor="hsl(75 80% 38%)" />
          </radialGradient>
        </defs>
      </svg>
      
      {/* Ground glow */}
      <div 
        className="absolute bottom-0 w-24 h-4 blur-md opacity-40"
        style={{
          background: "radial-gradient(ellipse, hsl(45 80% 50% / 0.5) 0%, transparent 70%)"
        }}
      />
    </div>
  );
};
