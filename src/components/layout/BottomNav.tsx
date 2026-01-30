import { useLocation, useNavigate } from "react-router-dom";
import { Shield, Headphones, MessageSquare, Eye, Settings } from "lucide-react";

const navItems = [
  { path: "/", icon: Shield, label: "Shield" },
  { path: "/war-room", icon: Headphones, label: "Audio" },
  { path: "/joshua", icon: MessageSquare, label: "Joshua" },
  { path: "/content-guard", icon: Eye, label: "Guard" },
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
