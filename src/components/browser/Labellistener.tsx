import React, { useEffect, useState } from 'react';
import PrototypeLabelModal from './PrototypeLabelModal';
import { startLabelQueueUploader, getPendingCount } from '@/lib/label-queue';

/**
 * This component listens for window.postMessage events of type 'gc-label-request'
 * and opens the PrototypeLabelModal for the tester/user to label.
 *
 * It also starts a background uploader to send queued labels to the backend.
 *
 * Usage: insert <LabelListener /> into NativeWebViewBrowser's JSX root.
 */

const LabelListener: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<any>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    startLabelQueueUploader(20_000); // attempt upload every 20s

    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'gc-label-request') {
        // message expected fields: requestId, itemId, src, pageUrl, platform, modelPrediction
        setContext({
          requestId: message.requestId,
          itemId: message.itemId,
          src: message.src,
          pageUrl: message.pageUrl || window.location.href,
          platform: message.platform || undefined,
          modelPrediction: message.modelPrediction || undefined,
        });
        setOpen(true);
      }
    };

    window.addEventListener('message', handler);
    // update pending count occasionally
    const iv = setInterval(() => setPendingCount(getPendingCount()), 3000);

    return () => {
      window.removeEventListener('message', handler);
      clearInterval(iv);
    };
  }, []);

  return (
    <>
      <PrototypeLabelModal open={open} onClose={() => setOpen(false)} context={context} />
      {/* small invisible badge for dev to show pending queue */}
      <div style={{ position: 'fixed', bottom: 10, right: 10, zIndex: 2147483646 }}>
        <div style={{
          fontSize: 11,
          background: '#111827',
          color: 'white',
          padding: '6px 10px',
          borderRadius: 18,
          opacity: 0.85
        }}>
          Labels pending: {pendingCount}
        </div>
      </div>
    </>
  );
};

export default LabelListener;
