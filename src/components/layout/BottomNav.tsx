import { useLocation, useNavigate } from "react-router-dom";
import { Home, Globe, Users, TrendingUp, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", icon: Home, label: "Home" },
  { path: "/browser", icon: Globe, label: "Safe Browser" },
  { path: "/partners", icon: Users, label: "Partners" },
  { path: "/growth", icon: TrendingUp, label: "Growth" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

export const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gold/20 bg-cathedral-midnight/95 backdrop-blur-md">
      {/* Top gold accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
      
      <div className="flex items-center justify-around py-2 px-2 max-w-lg mx-auto">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[60px]",
                isActive
                  ? "text-gold"
                  : "text-silver/60 hover:text-silver"
              )}
            >
              <div className={cn(
                "relative",
                isActive && "animate-pulse-gold"
              )}>
                <Icon
                  className={cn(
                    "w-5 h-5 transition-all",
                    isActive && "drop-shadow-[0_0_8px_hsl(45,100%,50%)]"
                  )}
                />
              </div>
              <span className={cn(
                "text-[10px] font-display tracking-wide",
                isActive ? "text-gold" : "text-silver/60"
              )}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
