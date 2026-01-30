import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BlockCheckRequest {
  url: string;
  deviceId?: string;
}

interface BlockCheckResult {
  isBlocked: boolean;
  domain: string;
  category: string | null;
  reason: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { url, deviceId }: BlockCheckRequest = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract domain from URL
    let domain: string;
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      domain = urlObj.hostname.replace(/^www\./, '');
    } catch {
      domain = url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }

    console.log(`Checking if domain is blocked: ${domain}`);

    // Check if domain or any parent domain is blocked
    const domainParts = domain.split('.');
    const domainsToCheck: string[] = [];
    
    for (let i = 0; i < domainParts.length - 1; i++) {
      domainsToCheck.push(domainParts.slice(i).join('.'));
    }

    const { data: blockedSites, error } = await supabase
      .from('blocked_sites')
      .select('domain, category')
      .eq('is_active', true)
      .in('domain', domainsToCheck);

    if (error) {
      console.error("Error checking blocked sites:", error);
      throw error;
    }

    const blockedSite = blockedSites?.[0];

    // Log the check if deviceId provided
    if (deviceId) {
      await supabase.from('content_moderation_logs').insert({
        device_id: deviceId,
        content_type: 'website',
        url: url,
        classification: blockedSite ? 'blocked' : 'allowed',
        confidence: 1.0,
        action_taken: blockedSite ? 'blocked' : 'allowed'
      });
    }

    const result: BlockCheckResult = {
      isBlocked: !!blockedSite,
      domain: domain,
      category: blockedSite?.category || null,
      reason: blockedSite 
        ? `This site is blocked under the "${blockedSite.category}" category.`
        : "Site is allowed."
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in check-blocked-site:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
