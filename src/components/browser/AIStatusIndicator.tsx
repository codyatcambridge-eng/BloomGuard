import { Shield, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

interface AIStatusIndicatorProps {
  state: 'idle' | 'loading' | 'ready' | 'error';
}

export const AIStatusIndicator = ({ state }: AIStatusIndicatorProps) => {
  const getStatusConfig = () => {
    switch (state) {
      case 'loading':
        return {
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          label: 'LOADING AI',
          className: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10',
        };
      case 'ready':
        return {
          icon: <CheckCircle2 className="w-3 h-3" />,
          label: 'AI READY',
          className: 'text-green-500 border-green-500/30 bg-green-500/10',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-3 h-3" />,
          label: 'AI ERROR',
          className: 'text-destructive border-destructive/30 bg-destructive/10',
        };
      default:
        return {
          icon: <Shield className="w-3 h-3" />,
          label: 'AI IDLE',
          className: 'text-silver border-silver/30 bg-silver/10',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-display ${config.className}`}>
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
};
