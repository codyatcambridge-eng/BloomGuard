/**
 * Prototype Label Modal
 * 
 * Shown when user taps "Reveal" on a blurred image.
 * Collects user labels for training data.
 */

import React, { useState } from 'react';
import { enqueueLabel } from '@/lib/label-queue';

export type UserLabel = 'shirtless' | 'swimwear' | 'other' | 'unsure';

export interface PrototypeLabelModalProps {
  open: boolean;
  onClose: () => void;
  context: {
    requestId?: string;
    itemId?: string;
    src?: string;
    pageUrl?: string;
    platform?: string;
    modelPrediction?: { category?: string; confidence?: number };
  } | null;
}

/**
 * Log correction event for later analysis
 */
function logCorrection(context: PrototypeLabelModalProps['context'], userLabel: UserLabel, wasCorrect: boolean) {
  const logEntry = {
    type: 'moderation-correction',
    timestamp: Date.now(),
    itemId: context?.itemId || 'unknown',
    src: context?.src || '',
    pageUrl: context?.pageUrl || window.location.href,
    platform: context?.platform || 'unknown',
    originalPrediction: context?.modelPrediction?.category || 'unknown',
    userLabel,
    wasCorrect,
  };
  
  console.log('[PrototypeLabelModal] Logging correction:', logEntry);
  
  // Store corrections in localStorage for later sync
  try {
    const key = 'mw_corrections_log';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push(logEntry);
    // Keep last 100 corrections
    if (existing.length > 100) {
      existing.shift();
    }
    localStorage.setItem(key, JSON.stringify(existing));
  } catch (e) {
    console.error('[PrototypeLabelModal] Failed to store correction:', e);
  }
}

/**
 * Simple modal UI for prototype labeling (beginner-friendly).
 * - Calls enqueueLabel() which persists to local queue and uploads when allowed.
 */
export const PrototypeLabelModal: React.FC<PrototypeLabelModalProps> = ({ open, onClose, context }) => {
  const [consentImage, setConsentImage] = useState<boolean>(false);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  if (!open || !context) return null;

  // Determine if the model was correct based on category
  const wasModelCorrect = (userLabel: UserLabel): boolean => {
    const modelCategory = context.modelPrediction?.category?.toLowerCase() || '';
    
    // If user says "other" (not problematic), model was wrong if it flagged it
    if (userLabel === 'other') {
      return modelCategory === 'neutral' || modelCategory === 'safe' || modelCategory === 'drawing';
    }
    
    // If user says shirtless/swimwear, model was correct if it flagged it
    if (userLabel === 'shirtless' || userLabel === 'swimwear') {
      return modelCategory !== 'neutral' && modelCategory !== 'safe';
    }
    
    // Unsure - can't determine correctness
    return true;
  };

  const handleLabel = async (userLabel: UserLabel) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Log correction for later analysis
      logCorrection(context, userLabel, wasModelCorrect(userLabel));
      
      // Minimal label payload
      await enqueueLabel({
        requestId: context.requestId || '',
        itemId: context.itemId || '',
        src: context.src || '',
        pageUrl: context.pageUrl || '',
        platform: context.platform || '',
        modelPrediction: context.modelPrediction || undefined,
        userLabel,
        userComment: comment || '',
        consentImage,
        timestamp: Date.now(),
      });
      // optimistic UI - close modal
      onClose();
    } catch (e) {
      console.error('[PrototypeLabelModal] enqueue failed', e);
      alert('Failed to save label locally. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      background: 'rgba(0,0,0,0.45)'
    }}>
      <div style={{
        width: 360,
        maxWidth: '90vw',
        background: '#fff',
        borderRadius: 10,
        padding: 18,
        boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
      }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>Was this content shirtless or swimwear?</h3>
        <p style={{ marginTop: 0, marginBottom: 12, color: '#444', fontSize: 14 }}>
          Your feedback helps improve detection accuracy.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          <button
            onClick={() => handleLabel('shirtless')}
            style={{ 
              padding: 12, 
              background: '#ef4444', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6, 
              fontWeight: 'bold',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
            disabled={submitting}
          >
            👕 Shirtless
          </button>

          <button
            onClick={() => handleLabel('swimwear')}
            style={{ 
              padding: 12, 
              background: '#1d4ed8', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6, 
              fontWeight: 'bold',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
            disabled={submitting}
          >
            🩱 Swimwear
          </button>

          <button
            onClick={() => handleLabel('other')}
            style={{ 
              padding: 12, 
              background: '#10b981', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6, 
              fontWeight: 'bold',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
            disabled={submitting}
          >
            ✓ Not Problematic
          </button>

          <button
            onClick={() => handleLabel('unsure')}
            style={{ 
              padding: 12, 
              background: '#6b7280', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
            disabled={submitting}
          >
            🤔 Unsure
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <textarea
            placeholder="Optional: Why did you choose this? (helps improve AI)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ 
              width: '100%', 
              minHeight: 70, 
              padding: 8, 
              borderRadius: 6, 
              border: '1px solid #e5e7eb',
              fontSize: 13,
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
          <input
            id="mw-consent-image"
            type="checkbox"
            checked={consentImage}
            onChange={(e) => setConsentImage(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <label htmlFor="mw-consent-image" style={{ fontSize: 12, color: '#666' }}>
            Allow image upload to improve the model (anonymous)
          </label>
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button 
            onClick={onClose} 
            style={{ 
              padding: '10px 16px', 
              borderRadius: 6, 
              background: '#f3f4f6', 
              border: 'none',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <div style={{ opacity: 0.6, fontSize: 11, color: '#6b7280' }}>
            {context.platform || 'Unknown'} • {context.modelPrediction?.category || 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrototypeLabelModal;
