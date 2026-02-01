import { useLocation, useNavigate } from "react-router-dom";
import { Shield, Globe, Users, FileText, Settings, Smartphone } from "lucide-react";

const navItems = [
  { path: "/", icon: Shield, label: "Home" },
  { path: "/browser", icon: Globe, label: "Cloud" },
  { path: "/local-browser", icon: Smartphone, label: "Local" },
  { path: "/accountability", icon: Users, label: "Partners" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

export const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm">
      <div className="flex items-center justify-around py-2 px-4 max-w-lg mx-auto">
        {navItems.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center gap-1 px-4 py-2 transition-all duration-200 ${
                isActive
                  ? "text-aqua"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon
                className={`w-6 h-6 ${isActive ? "drop-shadow-[0_0_8px_hsl(180,100%,50%)]" : ""}`}
              />
              <span className="text-xs font-medium uppercase tracking-wider">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
