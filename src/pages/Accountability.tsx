import { useState, useEffect } from "react";
import { Users, UserPlus, Copy, Check, Clock, XCircle, CheckCircle, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceId } from "@/hooks/useDeviceId";
import { toast } from "sonner";

interface Partner {
  id: string;
  user_device_id: string;
  partner_email: string | null;
  partner_device_id: string | null;
  status: string;
  invite_code: string | null;
  created_at: string;
}

interface OverrideRequest {
  id: string;
  requester_device_id: string;
  reason: string | null;
  status: string;
  created_at: string;
  expires_at: string | null;
}

const Accountability = () => {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [overrideRequests, setOverrideRequests] = useState<OverrideRequest[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'partners' | 'requests'>('partners');
  const deviceId = useDeviceId();

  useEffect(() => {
    if (deviceId) {
      loadData();
    }
  }, [deviceId]);

  const loadData = async () => {
    setIsLoading(true);
    
    // Load partnerships
    const { data: partnerData } = await supabase
      .from('accountability_partners')
      .select('*')
      .or(`user_device_id.eq.${deviceId},partner_device_id.eq.${deviceId}`)
      .order('created_at', { ascending: false });
    
    setPartners(partnerData || []);

    // Load override requests (both sent and received)
    const { data: requestData } = await supabase
      .from('override_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    
    setOverrideRequests(requestData || []);
    setIsLoading(false);
  };

  const generateInviteCode = () => {
    return 'IW-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleInvitePartner = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    const code = generateInviteCode();
    
    const { error } = await supabase
      .from('accountability_partners')
      .insert({
        user_device_id: deviceId,
        partner_email: inviteEmail.trim(),
        invite_code: code,
        status: 'pending',
      });

    if (error) {
      toast.error('Failed to send invite');
      console.error(error);
    } else {
      toast.success('Invite created! Share the code with your partner.');
      setInviteEmail("");
      loadData();
    }
  };

  const handleAcceptInvite = async () => {
    if (!inviteCode.trim()) {
      toast.error('Please enter an invite code');
      return;
    }

    const { data, error } = await supabase
      .from('accountability_partners')
      .update({ 
        partner_device_id: deviceId, 
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .eq('invite_code', inviteCode.trim().toUpperCase())
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) {
      toast.error('Invalid or expired invite code');
    } else {
      toast.success('Partnership activated!');
      setInviteCode("");
      loadData();
    }
  };

  const handleRequestOverride = async () => {
    const activePartner = partners.find(p => p.status === 'active');
    
    if (!activePartner) {
      toast.error('You need an active accountability partner first');
      return;
    }

    const { error } = await supabase
      .from('override_requests')
      .insert({
        requester_device_id: deviceId,
        partner_id: activePartner.id,
        reason: overrideReason || null,
        status: 'pending',
      });

    if (error) {
      toast.error('Failed to request override');
      console.error(error);
    } else {
      toast.success('Override request sent to partner');
      setOverrideReason("");
      loadData();
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // 15-minute bypass

    const { error } = await supabase
      .from('override_requests')
      .update({ 
        status: 'approved',
        responded_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq('id', requestId);

    if (error) {
      toast.error('Failed to approve request');
    } else {
      toast.success('Override approved for 15 minutes');
      loadData();
    }
  };

  const handleDenyRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('override_requests')
      .update({ 
        status: 'denied',
        responded_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (error) {
      toast.error('Failed to deny request');
    } else {
      toast.success('Override denied');
      loadData();
    }
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Invite code copied!');
  };

  const activePartners = partners.filter(p => p.status === 'active');
  const pendingInvites = partners.filter(p => p.status === 'pending' && p.user_device_id === deviceId);
  const pendingRequests = overrideRequests.filter(r => r.status === 'pending');

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-aqua" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">ACCOUNTABILITY</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              Partner Protection Network
            </p>
          </div>
        </div>
      </header>

      {/* Tab Selector */}
      <div className="px-4 py-4 flex gap-2">
        <button
          onClick={() => setActiveTab('partners')}
          className={`flex-1 py-3 px-4 font-display text-sm tracking-wider transition-all flex items-center justify-center gap-2 ${
            activeTab === 'partners'
              ? 'bg-aqua text-accent-foreground'
              : 'border border-silver/30 text-silver hover:border-silver/60'
          }`}
        >
          <Users className="w-4 h-4" />
          PARTNERS
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex-1 py-3 px-4 font-display text-sm tracking-wider transition-all flex items-center justify-center gap-2 ${
            activeTab === 'requests'
              ? 'bg-aqua text-accent-foreground'
              : 'border border-silver/30 text-silver hover:border-silver/60'
          }`}
        >
          <Clock className="w-4 h-4" />
          OVERRIDES
          {pendingRequests.length > 0 && (
            <span className="w-5 h-5 rounded-full bg-gold text-cathedral-midnight text-xs flex items-center justify-center">
              {pendingRequests.length}
            </span>
          )}
        </button>
      </div>

      <main className="px-4 py-4 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-aqua" />
          </div>
        ) : activeTab === 'partners' ? (
          <>
            {/* Invite Partner */}
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4" />
                INVITE PARTNER
              </h3>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="partner@email.com"
                  className="flex-1 bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
                />
                <button
                  onClick={handleInvitePartner}
                  className="px-4 py-3 bg-aqua text-accent-foreground font-display text-xs tracking-wider hover:bg-aqua/90 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </section>

            {/* Accept Invite */}
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                ACCEPT INVITE
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="IW-XXXXXX"
                  className="flex-1 bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors uppercase"
                />
                <button
                  onClick={handleAcceptInvite}
                  className="px-4 py-3 bg-gold text-cathedral-midnight font-display text-xs tracking-wider hover:bg-gold/90 transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            </section>

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <section className="cathedral-card">
                <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                  PENDING INVITES
                </h3>
                <div className="space-y-3">
                  {pendingInvites.map((invite) => (
                    <div key={invite.id} className="flex items-center justify-between p-3 bg-secondary/30 border border-silver/10">
                      <div>
                        <p className="text-sm text-foreground">{invite.partner_email}</p>
                        <p className="text-xs text-muted-foreground">Code: {invite.invite_code}</p>
                      </div>
                      <button
                        onClick={() => copyInviteCode(invite.invite_code || '')}
                        className="p-2 text-aqua hover:bg-aqua/10 transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Active Partners */}
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                ACTIVE PARTNERS ({activePartners.length})
              </h3>
              {activePartners.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No active partners yet
                </p>
              ) : (
                <div className="space-y-3">
                  {activePartners.map((partner) => (
                    <div key={partner.id} className="flex items-center gap-3 p-3 bg-secondary/30 border border-aqua/20">
                      <CheckCircle className="w-5 h-5 text-aqua" />
                      <div>
                        <p className="text-sm text-foreground">
                          {partner.partner_email || 'Partner Device'}
                        </p>
                        <p className="text-xs text-aqua">Active</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            {/* Request Override */}
            <section className="cathedral-card border-gold/30">
              <h3 className="font-display text-sm tracking-widest text-gold mb-3">
                REQUEST OVERRIDE
              </h3>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Reason for override (optional)..."
                rows={3}
                className="w-full bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-gold transition-colors resize-none mb-3"
              />
              <button
                onClick={handleRequestOverride}
                disabled={activePartners.length === 0}
                className="w-full py-3 font-display text-sm tracking-wider bg-gold text-cathedral-midnight hover:bg-gold/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                REQUEST BYPASS
              </button>
              {activePartners.length === 0 && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Add an accountability partner first
                </p>
              )}
            </section>

            {/* Pending Requests to Approve */}
            {pendingRequests.length > 0 && (
              <section className="cathedral-card border-gold/50">
                <h3 className="font-display text-sm tracking-widest text-gold mb-3">
                  REQUESTS TO REVIEW
                </h3>
                <div className="space-y-3">
                  {pendingRequests.map((request) => (
                    <div key={request.id} className="p-3 bg-secondary/30 border border-silver/10">
                      <p className="text-xs text-muted-foreground mb-2">
                        {new Date(request.created_at).toLocaleString()}
                      </p>
                      {request.reason && (
                        <p className="text-sm text-foreground mb-3">"{request.reason}"</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveRequest(request.id)}
                          className="flex-1 py-2 bg-aqua text-accent-foreground font-display text-xs tracking-wider hover:bg-aqua/90 transition-colors flex items-center justify-center gap-2"
                        >
                          <CheckCircle className="w-4 h-4" />
                          APPROVE
                        </button>
                        <button
                          onClick={() => handleDenyRequest(request.id)}
                          className="flex-1 py-2 bg-destructive text-destructive-foreground font-display text-xs tracking-wider hover:bg-destructive/90 transition-colors flex items-center justify-center gap-2"
                        >
                          <XCircle className="w-4 h-4" />
                          DENY
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Override History */}
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                OVERRIDE HISTORY
              </h3>
              {overrideRequests.filter(r => r.status !== 'pending').length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No override history
                </p>
              ) : (
                <div className="space-y-2">
                  {overrideRequests.filter(r => r.status !== 'pending').slice(0, 10).map((request) => (
                    <div key={request.id} className="flex items-center justify-between p-2 border-b border-silver/10">
                      <div className="flex items-center gap-2">
                        {request.status === 'approved' ? (
                          <CheckCircle className="w-4 h-4 text-aqua" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive" />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(request.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <span className={`text-xs font-display ${
                        request.status === 'approved' ? 'text-aqua' : 'text-destructive'
                      }`}>
                        {request.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default Accountability;
