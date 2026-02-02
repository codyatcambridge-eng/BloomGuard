import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LabelEntry {
  requestId: string;
  itemId: string;
  src: string;
  pageUrl: string;
  platform: string;
  modelPrediction: string;
  modelConfidence: number;
  userLabel: 'shirtless' | 'swimwear' | 'other' | 'unsure';
  userComment?: string;
  consentImage: boolean;
  imageBase64?: string;
  deviceMeta: {
    userAgent: string;
    screenWidth: number;
    screenHeight: number;
    timestamp: number;
    timezone: string;
  };
}

interface SubmitRequest {
  action: 'submit';
  labels: LabelEntry[];
}

interface StatsRequest {
  action: 'stats';
}

interface ListRequest {
  action: 'list';
  limit?: number;
  offset?: number;
  labelFilter?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (action === 'submit') {
      const { labels } = body as SubmitRequest;
      
      if (!labels || !Array.isArray(labels) || labels.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No labels provided' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[moderation-labels] Received ${labels.length} labels`);

      // Process each label
      const results = [];
      for (const label of labels) {
        try {
          // Store image if consent given
          let imagePath: string | null = null;
          if (label.consentImage && label.imageBase64) {
            // Extract base64 data
            const base64Data = label.imageBase64.split(',')[1] || label.imageBase64;
            const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            
            // Generate unique path
            const timestamp = Date.now();
            const fileName = `${label.userLabel}/${timestamp}_${label.itemId}.jpg`;
            
            // Upload to storage (create bucket if needed)
            const { error: uploadError } = await supabase.storage
              .from('moderation-training')
              .upload(fileName, imageBytes, {
                contentType: 'image/jpeg',
                upsert: true,
              });

            if (uploadError) {
              console.error('[moderation-labels] Image upload error:', uploadError);
            } else {
              imagePath = fileName;
              console.log('[moderation-labels] Image stored:', fileName);
            }
          }

          // Insert label record
          const { error: insertError } = await supabase
            .from('moderation_labels')
            .insert({
              request_id: label.requestId,
              item_id: label.itemId,
              src: label.src,
              page_url: label.pageUrl,
              platform: label.platform,
              model_prediction: label.modelPrediction,
              model_confidence: label.modelConfidence,
              user_label: label.userLabel,
              user_comment: label.userComment || null,
              consent_image: label.consentImage,
              image_path: imagePath,
              device_meta: label.deviceMeta,
            });

          if (insertError) {
            console.error('[moderation-labels] Insert error:', insertError);
            results.push({ itemId: label.itemId, success: false, error: insertError.message });
          } else {
            results.push({ itemId: label.itemId, success: true });
          }
        } catch (e) {
          console.error('[moderation-labels] Label processing error:', e);
          results.push({ itemId: label.itemId, success: false, error: e.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[moderation-labels] Processed ${successCount}/${labels.length} labels`);

      return new Response(
        JSON.stringify({ success: true, results, processed: successCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'stats') {
      // Get label statistics
      const { data: totalCount } = await supabase
        .from('moderation_labels')
        .select('*', { count: 'exact', head: true });

      const { data: byLabel } = await supabase
        .from('moderation_labels')
        .select('user_label');

      const labelCounts: Record<string, number> = {
        shirtless: 0,
        swimwear: 0,
        other: 0,
        unsure: 0,
      };

      byLabel?.forEach((row: { user_label: string }) => {
        if (row.user_label in labelCounts) {
          labelCounts[row.user_label]++;
        }
      });

      const { data: withImages } = await supabase
        .from('moderation_labels')
        .select('*', { count: 'exact', head: true })
        .not('image_path', 'is', null);

      return new Response(
        JSON.stringify({
          total: byLabel?.length || 0,
          byLabel: labelCounts,
          withImages: withImages?.length || 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'list') {
      const { limit = 50, offset = 0, labelFilter } = body as ListRequest;

      let query = supabase
        .from('moderation_labels')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (labelFilter) {
        query = query.eq('user_label', labelFilter);
      }

      const { data, error } = await query;

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ labels: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    console.error('[moderation-labels] Error:', e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
