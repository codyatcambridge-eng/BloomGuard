import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatRowProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  iconColor?: string;
  valueColor?: string;
  className?: string;
}

export const StatRow = ({ 
  icon: Icon, 
  label, 
  value, 
  iconColor = "text-gold",
  valueColor = "text-foreground",
  className 
}: StatRowProps) => {
  return (
    <div className={cn("flex items-center justify-between py-2", className)}>
      <div className="flex items-center gap-2">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <span className="text-sm text-silver">{label}</span>
      </div>
      <span className={cn("font-display text-lg", valueColor)}>{value}</span>
    </div>
  );
};
