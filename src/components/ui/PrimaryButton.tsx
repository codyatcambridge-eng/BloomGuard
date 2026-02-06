import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface PrimaryButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "gold" | "silver";
  className?: string;
  type?: "button" | "submit";
}

export const PrimaryButton = ({ 
  children, 
  onClick, 
  disabled = false,
  variant = "gold",
  className,
  type = "button"
}: PrimaryButtonProps) => {
  const variantStyles = {
    gold: "gold-button",
    silver: "silver-button",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        variantStyles[variant],
        "rounded-lg disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
};
