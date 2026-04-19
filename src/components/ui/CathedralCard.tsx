import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface CathedralCardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "silver" | "gold";
}

export const CathedralCard = ({ 
  children, 
  className,
  variant = "default" 
}: CathedralCardProps) => {
  const variantStyles = {
    default: "cathedral-card",
    silver: "silver-tablet",
    gold: "cathedral-card gold-frame",
  };

  return (
    <div className={cn(variantStyles[variant], className)}>
      {children}
    </div>
  );
};
