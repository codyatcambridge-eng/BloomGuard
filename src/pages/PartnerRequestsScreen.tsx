/**
 * Partner Requests Screen
 * 
 * Partner-facing view for reviewing and responding to protection requests.
 * Shows ONLY request type + time - NO content details, URLs, or platform info.
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Shield, Bell, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CathedralCard } from '@/components/ui/CathedralCard';
import { PartnerRequestCard } from '@/components/proguard';
import { 
  PartnerRequest, 
  PartnerRequestStatus,
} from '@/models/PartnerRequest';
import { 
  processExpiredRequests,
  EncouragementPreset,
} from '@/logic/proGuard';
import { 
  getPendingPartnerRequests, 
  savePartnerRequest,
  expireOverdueRequests,
} from '@/storage/eventsRepo';
import { toast } from 'sonner';

export default function PartnerRequestsScreen() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<PartnerRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load requests
  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    
    // First expire any overdue requests
    await expireOverdueRequests();
    
    // Then load pending requests
    const pending = await getPendingPartnerRequests();
    
    // Process any that expired since last check
    const processed = processExpiredRequests(pending);
    
    setRequests(processed);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadRequests();
    
    // Poll for updates every 10 seconds
    const interval = setInterval(loadRequests, 10000);
    return () => clearInterval(interval);
  }, [loadRequests]);

  // Handle approve
  const handleApprove = useCallback(async (
    request: PartnerRequest, 
    messagePreset?: EncouragementPreset
  ) => {
    const updated: PartnerRequest = {
      ...request,
      status: 'APPROVED',
      partnerMessagePreset: messagePreset ?? null,
    };
    
    await savePartnerRequest(updated);
    toast.success('Request approved');
    loadRequests();
  }, [loadRequests]);

  // Handle deny
  const handleDeny = useCallback(async (request: PartnerRequest) => {
    const updated: PartnerRequest = {
      ...request,
      status: 'DENIED',
    };
    
    await savePartnerRequest(updated);
    toast.info('Request denied');
    loadRequests();
  }, [loadRequests]);

  const pendingRequests = requests.filter(r => r.status === 'PENDING');
  const resolvedRequests = requests.filter(r => r.status !== 'PENDING');

  return (
    <div className="min-h-screen bg-obsidian text-foreground pb-20">
      {/* Header */}
      <div className="bg-obsidian-light/50 border-b border-silver/10 px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="text-silver hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="font-display text-lg text-foreground">Partner Requests</h1>
              <p className="text-xs text-muted-foreground">Review accountability requests</p>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={loadRequests}
            disabled={isLoading}
            className="text-silver hover:text-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Privacy Notice */}
        <CathedralCard className="p-3 flex items-start gap-3">
          <Shield className="w-4 h-4 text-gold shrink-0 mt-0.5" />
          <p className="text-xs text-silver">
            Privacy protected: You only see request types and times. 
            No browsing content, URLs, or platform details are ever shared.
          </p>
        </CathedralCard>

        {/* Pending Requests */}
        <section>
          <h2 className="text-sm text-silver mb-3 flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Pending Requests ({pendingRequests.length})
          </h2>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-gold animate-spin" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <CathedralCard className="p-6 text-center">
              <Shield className="w-10 h-10 text-silver/30 mx-auto mb-3" />
              <p className="text-silver">No pending requests</p>
              <p className="text-xs text-muted-foreground mt-1">
                All clear for now
              </p>
            </CathedralCard>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((request) => (
                <PartnerRequestCard
                  key={request.id}
                  request={request}
                  onApprove={(preset) => handleApprove(request, preset)}
                  onDeny={() => handleDeny(request)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recent History (last 5) */}
        {resolvedRequests.length > 0 && (
          <section>
            <h2 className="text-sm text-silver mb-3">Recent History</h2>
            <div className="space-y-2">
              {resolvedRequests.slice(0, 5).map((request) => (
                <PartnerRequestCard
                  key={request.id}
                  request={request}
                  onApprove={() => {}}
                  onDeny={() => {}}
                />
              ))}
            </div>
          </section>
        )}

        {/* Encouragement */}
        <p className="text-center text-xs text-muted-foreground italic pt-4">
          "Hold the line. Your presence strengthens their resolve."
        </p>
      </div>
    </div>
  );
}
