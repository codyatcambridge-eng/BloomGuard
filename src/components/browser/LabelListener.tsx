/**
 * LabelListener Component
 * 
 * Listens for window.postMessage events of type 'gc-label-request'
 * and opens the PrototypeLabelModal when received.
 */

import { useState, useEffect, useCallback } from 'react';
import { PrototypeLabelModal } from './PrototypeLabelModal';

interface LabelRequestMessage {
  type: 'gc-label-request';
  requestId: string;
  itemId: string;
  src: string;
  pageUrl?: string;
  platform?: string;
  modelPrediction?: {
    category?: string;
    confidence?: number;
    model_version?: string;
    thresholds?: Record<string, unknown>;
    predictions?: Record<string, unknown>;
    decision_reason?: string;
    image_width?: number;
    image_height?: number;
    host?: string;
    timestamp?: number;
  };
}

interface ModalContext {
  requestId?: string;
  itemId?: string;
  src?: string;
  pageUrl?: string;
  platform?: string;
  modelPrediction?: LabelRequestMessage['modelPrediction'];
}

function isLabelRequest(data: unknown): data is LabelRequestMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === 'gc-label-request' &&
    typeof msg.requestId === 'string' &&
    typeof msg.itemId === 'string' &&
    typeof msg.src === 'string'
  );
}

export function LabelListener() {
  const [modalOpen, setModalOpen] = useState(false);
  const [currentContext, setCurrentContext] = useState<ModalContext | null>(null);

  const handleMessage = useCallback((event: MessageEvent) => {
    const message = event.data;

    if (isLabelRequest(message)) {
      console.log('[LabelListener] received gc-label-request', message.itemId);

      setCurrentContext({
        requestId: message.requestId,
        itemId: message.itemId,
        src: message.src,
        pageUrl: message.pageUrl || window.location.href,
        platform: message.platform || undefined,
        modelPrediction: message.modelPrediction || undefined,
      });
      setModalOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const handleClose = useCallback(() => {
    setModalOpen(false);
    setCurrentContext(null);
  }, []);

  return (
    <PrototypeLabelModal
      open={modalOpen}
      onClose={handleClose}
      context={currentContext}
    />
  );
}

export default LabelListener;
