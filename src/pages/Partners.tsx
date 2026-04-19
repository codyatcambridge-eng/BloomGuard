import { useState, useEffect } from "react";
import { Users, UserPlus, Copy, Check, MessageSquare, Shield, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceId } from "@/hooks/useDeviceId";
import { toast } from "sonner";
import { CathedralCard } from "@/components/ui/CathedralCard";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { cn } from "@/lib/utils";

interface Partner {
  id: string;
  user_device_id: string;
  partner_email: string | null;
  partner_device_id: string | null;
  status: string;
  invite_code: string | null;
  created_at: string;
}

const Partners = () => {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const deviceId = useDeviceId();

  useEffect(() => {
    if (deviceId) {
      loadData();
    }
  }, [deviceId]);

  const loadData = async () => {
    setIsLoading(true);
    const { data: partnerData } = await supabase
      .from('accountability_partners')
      .select('*')
      .or(`user_device_id.eq.${deviceId},partner_device_id.eq.${deviceId}`)
      .order('created_at', { ascending: false });
    
    setPartners(partnerData || []);
    setIsLoading(false);
  };

  const generateInviteCode = () => {
    return 'MW-' + Math.random().toString(36).substring(2, 8).toUpperCase();
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

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Invite code copied!');
  };

  const activePartners = partners.filter(p => p.status === 'active');
  const pendingInvites = partners.filter(p => p.status === 'pending' && p.user_device_id === deviceId);

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Golden beam accent */}
      <div className="golden-beam" />

      {/* Header */}
      <header className="relative z-10 px-5 pt-10 pb-6 text-center border-b border-gold/20">
        <h1 className="font-display text-3xl text-gold tracking-wider mb-2">
          Partners
        </h1>
        <p className="text-sm text-silver max-w-xs mx-auto">
          Share the journey of shield-strength & growth with trusted allies.
        </p>
      </header>

      <main className="relative z-10 px-4 py-6 space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gold" />
          </div>
        ) : (
          <>
            {/* Shield Status */}
            <CathedralCard variant="gold" className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Shield className="w-5 h-5 text-gold" />
                <h3 className="font-display text-lg text-gold">Safe Haven Shield</h3>
              </div>
              <p className="text-sm text-silver">Shield is holding strong.</p>
              <p className="text-xs text-silver/60 mt-2">
                Next Check-In available
              </p>
            </CathedralCard>

            {/* Active Partners */}
            <section>
              <h3 className="font-display text-sm text-silver tracking-wider mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-gold" />
                MY ALLIES ({activePartners.length})
              </h3>
              
              {activePartners.length === 0 ? (
                <CathedralCard className="text-center py-8">
                  <Users className="w-10 h-10 text-silver/40 mx-auto mb-3" />
                  <p className="text-silver text-sm">No allies yet</p>
                  <p className="text-silver/60 text-xs mt-1">
                    Add an accountability ally below
                  </p>
                </CathedralCard>
              ) : (
                <div className="space-y-3">
                  {activePartners.map((partner) => (
                    <CathedralCard key={partner.id} className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold/30 to-gold/10 border border-gold/30 flex items-center justify-center">
                        <Users className="w-5 h-5 text-gold" />
                      </div>
                      <div className="flex-1">
                        <p className="text-foreground font-medium">
                          {partner.partner_email || 'Accountability Ally'}
                        </p>
                        <p className="text-xs text-techBlue">Active Partner</p>
                      </div>
                      <button 
                        className="p-2 rounded-lg bg-techBlue/20 border border-techBlue/30 text-tech-blue"
                        onClick={() => toast.info('Check-in feature coming soon')}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </CathedralCard>
                  ))}
                </div>
              )}
            </section>

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <section>
                <h3 className="font-display text-sm text-silver tracking-wider mb-3">
                  PENDING INVITES
                </h3>
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <CathedralCard key={invite.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground">{invite.partner_email}</p>
                        <p className="text-xs text-gold font-mono">{invite.invite_code}</p>
                      </div>
                      <button
                        onClick={() => copyInviteCode(invite.invite_code || '')}
                        className="p-2 text-gold hover:bg-gold/10 rounded-lg transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </CathedralCard>
                  ))}
                </div>
              </section>
            )}

            {/* Add Ally */}
            <section>
              <h3 className="font-display text-sm text-silver tracking-wider mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-gold" />
                ADD ACCOUNTABILITY ALLY
              </h3>
              
              <CathedralCard className="space-y-4">
                <div>
                  <label className="text-xs text-silver mb-2 block">Invite by Email</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="partner@email.com"
                      className="flex-1 bg-cathedral-deep border border-silver/20 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-silver/40 focus:outline-none focus:border-gold/50 transition-colors"
                    />
                    <PrimaryButton onClick={handleInvitePartner}>
                      Invite
                    </PrimaryButton>
                  </div>
                </div>
                
                <div className="border-t border-silver/10 pt-4">
                  <label className="text-xs text-silver mb-2 block">Accept Invite Code</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="MW-XXXXXX"
                      className="flex-1 bg-cathedral-deep border border-silver/20 rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-silver/40 focus:outline-none focus:border-gold/50 transition-colors uppercase font-mono"
                    />
                    <PrimaryButton variant="silver" onClick={handleAcceptInvite}>
                      Accept
                    </PrimaryButton>
                  </div>
                </div>
              </CathedralCard>
            </section>

            {/* Check In Button */}
            <PrimaryButton 
              className="w-full py-4 text-base"
              onClick={() => toast.info('Check-in to Alliance feature coming soon')}
            >
              Check In to Alliance
            </PrimaryButton>
          </>
        )}
      </main>
    </div>
  );
};

export default Partners;
