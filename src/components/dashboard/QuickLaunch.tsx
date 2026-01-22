import { useNavigate } from "react-router-dom";
import { Headphones, MessageSquare } from "lucide-react";

export const QuickLaunch = () => {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        onClick={() => navigate("/war-room")}
        className="cathedral-card flex flex-col items-center gap-3 py-6 transition-all duration-200 hover:border-aqua/50 active:scale-[0.98]"
      >
        <Headphones className="w-8 h-8 text-aqua" />
        <span className="font-display text-sm tracking-wider">WAR ROOM</span>
      </button>
      <button
        onClick={() => navigate("/joshua")}
        className="cathedral-card flex flex-col items-center gap-3 py-6 transition-all duration-200 hover:border-aqua/50 active:scale-[0.98]"
      >
        <MessageSquare className="w-8 h-8 text-aqua" />
        <span className="font-display text-sm tracking-wider">JOSHUA AI</span>
      </button>
    </div>
  );
};
