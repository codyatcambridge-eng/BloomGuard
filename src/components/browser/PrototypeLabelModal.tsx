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
 * Simple modal UI for prototype labeling (beginner-friendly).
 * - Calls enqueueLabel() which persists to local queue and uploads when allowed.
 */
export const PrototypeLabelModal: React.FC<PrototypeLabelModalProps> = ({ open, onClose, context }) => {
  const [consentImage, setConsentImage] = useState<boolean>(false);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  if (!open || !context) return null;

  const handleLabel = async (userLabel: UserLabel) => {
    if (submitting) return;
    setSubmitting(true);
    try {
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
        background: '#fff',
        borderRadius: 10,
        padding: 18,
        boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
      }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>Was this content shirtless or swimwear?</h3>
        <p style={{ marginTop: 0, marginBottom: 12, color: '#444' }}>
          Choose the category that best matches. Your feedback helps improve detection.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          <button
            onClick={() => handleLabel('shirtless')}
            style={{ padding: 12, background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, fontWeight: 'bold' }}
            disabled={submitting}
          >
            Shirtless
          </button>

          <button
            onClick={() => handleLabel('swimwear')}
            style={{ padding: 12, background: '#1d4ed8', color: 'white', border: 'none', borderRadius: 6, fontWeight: 'bold' }}
            disabled={submitting}
          >
            Swimwear
          </button>

          <button
            onClick={() => handleLabel('other')}
            style={{ padding: 12, background: '#10b981', color: 'white', border: 'none', borderRadius: 6, fontWeight: 'bold' }}
            disabled={submitting}
          >
            Not Problematic
          </button>

          <button
            onClick={() => handleLabel('unsure')}
            style={{ padding: 12, background: '#6b7280', color: 'white', border: 'none', borderRadius: 6 }}
            disabled={submitting}
          >
            Unsure
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <textarea
            placeholder="Optional comment (why you chose this)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ width: '100%', minHeight: 80, padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
          />
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
          <input
            id="mw-consent-image"
            type="checkbox"
            checked={consentImage}
            onChange={(e) => setConsentImage(e.target.checked)}
          />
          <label htmlFor="mw-consent-image" style={{ marginLeft: 8, fontSize: 13 }}>
            Upload image bytes to improve model (explicit consent)
          </label>
        </div>

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={onClose} style={{ padding: '10px 14px', borderRadius: 6, background: '#f3f4f6', border: 'none' }}>Cancel</button>
          <div style={{ opacity: 0.8, fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>{context.platform || ''}</div>
        </div>
      </div>
    </div>
  );
};

export default PrototypeLabelModal;
