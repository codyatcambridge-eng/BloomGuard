import { useRef, useState } from "react";
import { Shield, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

interface AIStatusIndicatorProps {
  state: 'idle' | 'loading' | 'ready' | 'error';
  onReport?: (report: {
    timestamp: number;
    reportType: 'false_positive' | 'missed';
    selectedLabels: string[];
    userNote?: string;
  }) => void;
}

export const AIStatusIndicator = ({ state, onReport }: AIStatusIndicatorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [otherNote, setOtherNote] = useState('');
  const reportsRef = useRef<Array<{
    timestamp: number;
    reportType: 'false_positive' | 'missed';
    selectedLabels: string[];
    userNote?: string;
  }>>([]);

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
  const labels = ['shirtless', 'swimwear', 'lingerie', 'other'];

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const submitReport = (reportType: 'false_positive' | 'missed') => {
    const note = otherNote.trim().slice(0, 120);
    const normalizedLabels = selectedLabels.filter((label) => label !== 'other');
    if (selectedLabels.includes('other')) {
      normalizedLabels.push(note ? `other:${note}` : 'other');
    }
    const report = {
      timestamp: Date.now(),
      reportType,
      selectedLabels: normalizedLabels,
      userNote: note || undefined,
    };
    reportsRef.current.push(report);
    if (onReport) onReport(report);
    setIsOpen(false);
    setSelectedLabels([]);
    setOtherNote('');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-display ${config.className}`}
        aria-label="Open shield report panel"
      >
        {config.icon}
        <span>{config.label}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[2147483001] bg-black/50 pointer-events-auto flex items-start justify-end p-4">
          <div
            className="w-full max-w-xs rounded-lg border border-border bg-background shadow-2xl p-3"
            style={{ marginTop: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-aqua" />
              <p className="text-xs font-display tracking-wider">SHIELD REPORT</p>
            </div>

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => submitReport('false_positive')}
                className="flex-1 text-xs px-2 py-2 rounded border border-border hover:bg-muted/40"
              >
                Report False Positive
              </button>
              <button
                type="button"
                onClick={() => submitReport('missed')}
                className="flex-1 text-xs px-2 py-2 rounded border border-border hover:bg-muted/40"
              >
                Report Missed Content
              </button>
            </div>

            <div className="mb-3">
              <p className="text-[11px] text-muted-foreground mb-2">Category labels</p>
              <div className="flex flex-wrap gap-2">
                {labels.map((label) => {
                  const selected = selectedLabels.includes(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleLabel(label)}
                      className={`text-[11px] px-2 py-1 rounded border ${selected ? 'border-aqua text-aqua bg-aqua/10' : 'border-border text-foreground'}`}
                    >
                      {label.charAt(0).toUpperCase() + label.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedLabels.includes('other') && (
              <input
                value={otherNote}
                onChange={(event) => setOtherNote(event.target.value)}
                placeholder="Optional note"
                maxLength={120}
                className="w-full mb-3 text-xs px-2 py-1.5 rounded border border-border bg-background"
              />
            )}

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-full text-xs px-2 py-2 rounded border border-border hover:bg-muted/40"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
