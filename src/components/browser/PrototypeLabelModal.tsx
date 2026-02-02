/**
 * Prototype Label Modal
 * 
 * Shown when user taps "Reveal" on a blurred image.
 * Collects user labels for training data.
 */

import { useState } from 'react';
import { X, Send, Camera, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addLabelToQueue, UserLabel } from '@/lib/label-queue';
import { useTriggerSettings } from '@/hooks/useTriggerSettings';
import { toast } from 'sonner';

interface PrototypeLabelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReveal: () => void;
  imageSrc: string;
  modelPrediction: string;
  modelConfidence: number;
  requestId: string;
  itemId: string;
  pageUrl: string;
  platform: string;
}

const LABEL_OPTIONS: { value: UserLabel; label: string; icon: string; description: string }[] = [
  { value: 'shirtless', label: 'Shirtless', icon: '👕', description: 'Person without a shirt' },
  { value: 'swimwear', label: 'Swimwear', icon: '👙', description: 'Person in swimsuit/bikini' },
  { value: 'other', label: 'Not Problematic', icon: '✅', description: 'Safe content, false positive' },
  { value: 'unsure', label: 'Unsure', icon: '🤔', description: 'Not sure how to classify' },
];

export const PrototypeLabelModal = ({
  open,
  onOpenChange,
  onReveal,
  imageSrc,
  modelPrediction,
  modelConfidence,
  requestId,
  itemId,
  pageUrl,
  platform,
}: PrototypeLabelModalProps) => {
  const { prototypeConsent, setPrototypeConsent } = useTriggerSettings();
  const [selectedLabel, setSelectedLabel] = useState<UserLabel | null>(null);
  const [comment, setComment] = useState('');
  const [consentImage, setConsentImage] = useState(prototypeConsent);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedLabel) {
      toast.error('Please select a label');
      return;
    }

    setIsSubmitting(true);

    try {
      // Fetch image as base64 if consent given
      let imageBase64: string | undefined;
      if (consentImage && imageSrc) {
        try {
          const response = await fetch(imageSrc);
          const blob = await response.blob();
          imageBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn('[LabelModal] Could not fetch image for upload:', e);
        }
      }

      // Add to queue
      addLabelToQueue({
        requestId,
        itemId,
        src: imageSrc,
        pageUrl,
        platform,
        modelPrediction,
        modelConfidence,
        userLabel: selectedLabel,
        userComment: comment || undefined,
        consentImage,
        imageBase64,
      });

      // Update global consent preference
      if (consentImage !== prototypeConsent) {
        setPrototypeConsent(consentImage);
      }

      toast.success('Label saved! Thank you for helping improve detection.');
      
      // Close modal and reveal image
      onOpenChange(false);
      onReveal();
    } catch (e) {
      console.error('[LabelModal] Submit error:', e);
      toast.error('Failed to save label. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    // Just reveal without labeling
    onOpenChange(false);
    onReveal();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-aqua" />
            Help Improve Detection
          </DialogTitle>
          <DialogDescription>
            What type of content is this? Your feedback helps train better AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Model prediction info */}
          <div className="p-3 bg-muted/50 rounded-lg text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">AI Prediction:</span>
              <span className="font-medium capitalize">{modelPrediction}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-muted-foreground">Confidence:</span>
              <span className="font-medium">{(modelConfidence * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* Label buttons */}
          <div className="grid grid-cols-2 gap-2">
            {LABEL_OPTIONS.map(option => (
              <Button
                key={option.value}
                variant={selectedLabel === option.value ? 'default' : 'outline'}
                className={`h-auto py-3 flex flex-col items-center gap-1 ${
                  selectedLabel === option.value ? 'ring-2 ring-aqua' : ''
                }`}
                onClick={() => setSelectedLabel(option.value)}
              >
                <span className="text-xl">{option.icon}</span>
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-[10px] text-muted-foreground">{option.description}</span>
              </Button>
            ))}
          </div>

          {/* Optional comment */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Additional notes (optional)
            </Label>
            <Textarea
              placeholder="Any additional context..."
              value={comment}
              onChange={e => setComment(e.target.value)}
              className="h-16 text-sm"
            />
          </div>

          {/* Consent checkbox */}
          <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <Checkbox
              id="consent"
              checked={consentImage}
              onCheckedChange={(checked) => setConsentImage(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="consent" className="text-sm font-medium cursor-pointer">
                Upload image to help improve AI
              </Label>
              <p className="text-xs text-muted-foreground">
                I consent to having this image stored securely for training purposes.
                Images are encrypted and never shared.
              </p>
            </div>
          </div>

          {/* Privacy notice */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <p>
              Labels are used to improve content detection. 
              {consentImage ? ' Image will be uploaded.' : ' Image will NOT be uploaded.'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={handleSkip} disabled={isSubmitting}>
            Skip & Reveal
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedLabel || isSubmitting}>
            <Send className="w-4 h-4 mr-2" />
            {isSubmitting ? 'Saving...' : 'Submit & Reveal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
