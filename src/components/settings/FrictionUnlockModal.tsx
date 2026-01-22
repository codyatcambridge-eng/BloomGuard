import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";

interface FrictionUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlock: () => void;
}

const REQUIRED_VERSE = "Be sober, be vigilant; because your adversary the devil, as a roaring lion, walketh about, seeking whom he may devour.";
const VERSE_REFERENCE = "1 Peter 5:8";

export const FrictionUnlockModal = ({ isOpen, onClose, onUnlock }: FrictionUnlockModalProps) => {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (input.trim() === REQUIRED_VERSE) {
      setInput("");
      setError(false);
      onUnlock();
    } else {
      setError(true);
    }
  };

  const handleClose = () => {
    setInput("");
    setError(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/90 backdrop-blur-sm">
      <div className="w-full max-w-md cathedral-card border-destructive">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <h2 className="font-display text-lg tracking-wider text-destructive">
              FRICTION UNLOCK
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning */}
        <p className="text-sm text-muted-foreground mb-4">
          To disable The Iron Shield, you must hand-type the following verse exactly:
        </p>

        {/* Verse to type */}
        <div className="bg-secondary/50 border border-border p-4 mb-4">
          <p className="text-sm italic text-foreground leading-relaxed">
            "{REQUIRED_VERSE}"
          </p>
          <p className="text-xs text-aqua mt-2 font-display">— {VERSE_REFERENCE} KJV</p>
        </div>

        {/* Input */}
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(false);
          }}
          placeholder="Type the verse exactly..."
          rows={4}
          className={`w-full bg-input border rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors resize-none ${
            error ? "border-destructive" : "border-border focus:border-aqua"
          }`}
        />

        {error && (
          <p className="text-xs text-destructive mt-2">
            The verse does not match. Type it exactly as shown.
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleClose}
            className="flex-1 py-3 text-sm font-display tracking-wider border border-border hover:border-foreground transition-colors"
          >
            KEEP SHIELD ACTIVE
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-3 text-sm font-display tracking-wider bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            DEACTIVATE
          </button>
        </div>
      </div>
    </div>
  );
};
