import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface LabelPayload {
  requestId: string;
  itemId: string;
  src: string;
  pageUrl?: string;
  platform?: string | null;
  userLabel: 'shirtless' | 'swimwear' | 'other' | 'unsure';
  consentUpload: boolean;
  createdAt: string;
  modelPrediction?: { category?: string | null; confidence?: number | null } | null;
  status: 'pending' | 'uploaded' | 'failed';
  attempts: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // API Key validation
    const apiKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    const expectedKey = Deno.env.get("MW_API_KEY");

    if (!expectedKey) {
      console.error("[moderation-labels] MW_API_KEY not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!apiKey || apiKey !== expectedKey) {
      console.warn("[moderation-labels] Invalid or missing API key");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle POST - submit labels
    if (req.method === "POST") {
      const body = await req.json();
      
      // Support single label or array of labels
      const labels: LabelPayload[] = Array.isArray(body) ? body : [body];

      if (labels.length === 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "No labels provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[moderation-labels] Received ${labels.length} label(s)`);

      const results: { itemId: string; success: boolean; error?: string }[] = [];

      for (const label of labels) {
        // Validate required fields
        if (!label.requestId || !label.itemId || !label.src || !label.userLabel) {
          results.push({ itemId: label.itemId || "unknown", success: false, error: "Missing required fields" });
          continue;
        }

        // Validate userLabel enum
        if (!['shirtless', 'swimwear', 'other', 'unsure'].includes(label.userLabel)) {
          results.push({ itemId: label.itemId, success: false, error: "Invalid userLabel value" });
          continue;
        }

        try {
          const { error: insertError } = await supabase
            .from("moderation_labels")
            .insert({
              request_id: label.requestId,
              item_id: label.itemId,
              src: label.src,
              page_url: label.pageUrl || null,
              platform: label.platform || null,
              user_label: label.userLabel,
              consent_upload: label.consentUpload ?? false,
              created_at: label.createdAt || new Date().toISOString(),
              model_prediction: label.modelPrediction || null,
              status: "uploaded", // Mark as uploaded since we received it
              attempts: (label.attempts || 0) + 1,
            });

          if (insertError) {
            console.error("[moderation-labels] Insert error:", insertError);
            results.push({ itemId: label.itemId, success: false, error: insertError.message });
          } else {
            results.push({ itemId: label.itemId, success: true });
          }
        } catch (e) {
          console.error("[moderation-labels] Processing error:", e);
          results.push({ itemId: label.itemId, success: false, error: e instanceof Error ? e.message : "Unknown error" });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[moderation-labels] Processed ${successCount}/${labels.length} labels`);

      return new Response(
        JSON.stringify({ ok: true, processed: successCount, total: labels.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle GET - list labels (for admin viewer)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const labelFilter = url.searchParams.get("label");

      let query = supabase
        .from("moderation_labels")
        .select("*")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (labelFilter && ['shirtless', 'swimwear', 'other', 'unsure'].includes(labelFilter)) {
        query = query.eq("user_label", labelFilter);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error("[moderation-labels] Query error:", error);
        return new Response(
          JSON.stringify({ ok: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get stats
      const { data: statsData } = await supabase
        .from("moderation_labels")
        .select("user_label");

      const stats = { shirtless: 0, swimwear: 0, other: 0, unsure: 0, total: 0 };
      statsData?.forEach((row: { user_label: string }) => {
        if (row.user_label in stats) {
          stats[row.user_label as keyof typeof stats]++;
        }
        stats.total++;
      });

      return new Response(
        JSON.stringify({ ok: true, labels: data, stats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error("[moderation-labels] Error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
