import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AccountabilityRequest {
  action: 'invite' | 'accept' | 'request_override' | 'approve_override' | 'deny_override' | 'status';
  deviceId: string;
  email?: string;
  inviteCode?: string;
  requestId?: string;
  reason?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, deviceId, email, inviteCode, requestId, reason }: AccountabilityRequest = await req.json();

    console.log(`Accountability action: ${action} from device: ${deviceId}`);

    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: "Device ID is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'invite': {
        if (!email) {
          return new Response(
            JSON.stringify({ error: "Email is required for invite" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const code = 'IW-' + crypto.randomUUID().substring(0, 6).toUpperCase();
        
        const { data, error } = await supabase
          .from('accountability_partners')
          .insert({
            user_device_id: deviceId,
            partner_email: email,
            invite_code: code,
            status: 'pending',
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, inviteCode: code, partnership: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'accept': {
        if (!inviteCode) {
          return new Response(
            JSON.stringify({ error: "Invite code is required" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabase
          .from('accountability_partners')
          .update({
            partner_device_id: deviceId,
            status: 'active',
            accepted_at: new Date().toISOString(),
          })
          .eq('invite_code', inviteCode.toUpperCase())
          .eq('status', 'pending')
          .select()
          .single();

        if (error || !data) {
          return new Response(
            JSON.stringify({ error: "Invalid or expired invite code" }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, partnership: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'request_override': {
        // Find active partnership for this device
        const { data: partner } = await supabase
          .from('accountability_partners')
          .select('*')
          .or(`user_device_id.eq.${deviceId},partner_device_id.eq.${deviceId}`)
          .eq('status', 'active')
          .single();

        if (!partner) {
          return new Response(
            JSON.stringify({ error: "No active accountability partner found" }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabase
          .from('override_requests')
          .insert({
            requester_device_id: deviceId,
            partner_id: partner.id,
            reason: reason || null,
            status: 'pending',
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, request: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'approve_override': {
        if (!requestId) {
          return new Response(
            JSON.stringify({ error: "Request ID is required" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);

        const { data, error } = await supabase
          .from('override_requests')
          .update({
            status: 'approved',
            responded_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
          })
          .eq('id', requestId)
          .select()
          .single();

        if (error) throw error;

        // Create unlock token for the requester
        const { data: request } = await supabase
          .from('override_requests')
          .select('requester_device_id')
          .eq('id', requestId)
          .single();

        if (request) {
          await supabase.from('unlock_tokens').insert({
            device_id: request.requester_device_id,
            token: crypto.randomUUID(),
            expires_at: expiresAt.toISOString(),
            reason: 'partner_approved',
          });
        }

        return new Response(
          JSON.stringify({ success: true, request: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'deny_override': {
        if (!requestId) {
          return new Response(
            JSON.stringify({ error: "Request ID is required" }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabase
          .from('override_requests')
          .update({
            status: 'denied',
            responded_at: new Date().toISOString(),
          })
          .eq('id', requestId)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, request: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'status': {
        // Get active partnerships
        const { data: partners } = await supabase
          .from('accountability_partners')
          .select('*')
          .or(`user_device_id.eq.${deviceId},partner_device_id.eq.${deviceId}`)
          .eq('status', 'active');

        // Get pending override requests for this device
        const { data: pendingRequests } = await supabase
          .from('override_requests')
          .select('*')
          .eq('requester_device_id', deviceId)
          .eq('status', 'pending');

        // Get valid unlock tokens
        const { data: tokens } = await supabase
          .from('unlock_tokens')
          .select('*')
          .eq('device_id', deviceId)
          .eq('used', false)
          .gt('expires_at', new Date().toISOString());

        return new Response(
          JSON.stringify({
            hasPartner: (partners?.length || 0) > 0,
            partners: partners || [],
            pendingRequests: pendingRequests || [],
            activeTokens: tokens || [],
            isUnlocked: (tokens?.length || 0) > 0,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error("Error in accountability:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
