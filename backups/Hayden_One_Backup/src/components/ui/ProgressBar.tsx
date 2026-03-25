import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  showValues?: boolean;
  variant?: "gold" | "blue" | "silver";
  className?: string;
}

export const ProgressBar = ({ 
  value, 
  max, 
  label,
  showValues = true,
  variant = "gold",
  className 
}: ProgressBarProps) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const fillStyles = {
    gold: "progress-fill-gold",
    blue: "progress-fill-blue",
    silver: "bg-gradient-to-r from-silver-dim to-silver",
  };

  return (
    <div className={cn("space-y-1", className)}>
      {(label || showValues) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-silver">{label}</span>}
          {showValues && (
            <span className="text-gold font-display">
              {value} / {max}
            </span>
          )}
        </div>
      )}
      <div className="progress-track">
        <div 
          className={cn(fillStyles[variant], "transition-all duration-500")}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
