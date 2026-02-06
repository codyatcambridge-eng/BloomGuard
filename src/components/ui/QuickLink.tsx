import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickLinkProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  iconColor?: string;
  className?: string;
}

export const QuickLink = ({ 
  icon: Icon, 
  label, 
  onClick,
  iconColor = "text-gold",
  className 
}: QuickLinkProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "cathedral-card flex flex-col items-center justify-center gap-2 p-4 hover:border-gold/50 transition-all duration-200 active:scale-95",
        className
      )}
    >
      <Icon className={cn("w-6 h-6", iconColor)} />
      <span className="text-xs text-silver font-display tracking-wide">
        {label}
      </span>
    </button>
  );
};
