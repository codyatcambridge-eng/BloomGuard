import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LABELS_PER_REQUEST = 50;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const VALID_USER_LABELS = new Set(["shirtless", "swimwear", "other", "unsure"]);
const textEncoder = new TextEncoder();
const userRequestWindow = new Map<string, { startedAt: number; count: number }>();

interface LabelPayload {
  requestId: string;
  itemId: string;
  src: string;
  pageUrl?: string;
  platform?: string | null;
  userLabel: "shirtless" | "swimwear" | "other" | "unsure";
  consentUpload?: boolean;
  createdAt?: string;
  modelPrediction?: { category?: string | null; confidence?: number | null } | null;
  model_version?: string | null;
  thresholds?: Record<string, unknown> | null;
  predictions?: Record<string, unknown> | null;
  decision_reason?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  host?: string | null;
  timestamp?: number | null;
  attempts?: number | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim();
}

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const current = userRequestWindow.get(userId);
  if (!current || now - current.startedAt > RATE_LIMIT_WINDOW_MS) {
    userRequestWindow.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  current.count += 1;
  userRequestWindow.set(userId, current);
  return false;
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[moderation-labels] Missing Supabase env config");
      return jsonResponse({ ok: false, error: "Server misconfigured" }, 500);
    }

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.warn("[moderation-labels] Invalid JWT:", userError?.message || "no user");
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    if (isRateLimited(user.id)) {
      return jsonResponse({ ok: false, error: "Too many requests" }, 429);
    }

    if (req.method === "POST") {
      const contentLength = Number(req.headers.get("content-length") || "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "Payload too large" }, 413);
      }

      const rawBody = await req.text();
      if (textEncoder.encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "Payload too large" }, 413);
      }

      let parsedBody: unknown;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        return jsonResponse({ ok: false, error: "Invalid JSON payload" }, 400);
      }

      const labels = Array.isArray(parsedBody) ? parsedBody : parsedBody ? [parsedBody] : [];
      if (labels.length === 0) {
        return jsonResponse({ ok: false, error: "No labels provided" }, 400);
      }
      if (labels.length > MAX_LABELS_PER_REQUEST) {
        return jsonResponse({ ok: false, error: "Too many labels in one request" }, 413);
      }

      console.log(`[moderation-labels] Received ${labels.length} label(s) for user ${user.id}`);

      const results: { itemId: string; success: boolean; error?: string }[] = [];

      for (const rawLabel of labels) {
        const label = rawLabel as Partial<LabelPayload> | null;
        const requestId = safeString(label?.requestId);
        const itemId = safeString(label?.itemId) || "unknown";
        const src = safeString(label?.src);
        const userLabel = safeString(label?.userLabel);

        if (!requestId || !src || !userLabel) {
          results.push({ itemId, success: false, error: "Missing required fields" });
          continue;
        }

        if (!VALID_USER_LABELS.has(userLabel)) {
          results.push({ itemId, success: false, error: "Invalid userLabel value" });
          continue;
        }

        const createdAt = safeString(label?.createdAt) || new Date().toISOString();
        const attempts = Math.max(0, Math.floor(safeNumber(label?.attempts) ?? 0));

        const modelPrediction =
          label?.modelPrediction && typeof label.modelPrediction === "object"
            ? { ...label.modelPrediction }
            : {};

        try {
          const { error: insertError } = await supabase.from("moderation_labels").insert({
            user_id: user.id,
            request_id: requestId,
            item_id: itemId,
            src,
            page_url: safeString(label?.pageUrl),
            platform: safeString(label?.platform),
            user_label: userLabel,
            consent_upload: label?.consentUpload === true,
            created_at: createdAt,
            model_prediction: {
              ...modelPrediction,
              model_version: safeString(label?.model_version),
              thresholds:
                label?.thresholds && typeof label.thresholds === "object" ? label.thresholds : null,
              predictions:
                label?.predictions && typeof label.predictions === "object"
                  ? label.predictions
                  : null,
              decision_reason: safeString(label?.decision_reason),
              image_width: safeNumber(label?.image_width),
              image_height: safeNumber(label?.image_height),
              host: safeString(label?.host),
              timestamp: safeNumber(label?.timestamp),
            },
            status: "uploaded",
            attempts: Math.min(attempts + 1, 1000),
          });

          if (insertError) {
            console.error("[moderation-labels] Insert error:", insertError);
            results.push({ itemId, success: false, error: insertError.message });
          } else {
            results.push({ itemId, success: true });
          }
        } catch (e) {
          console.error("[moderation-labels] Processing error:", e);
          results.push({
            itemId,
            success: false,
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      }

      const successCount = results.filter((result) => result.success).length;
      console.log(`[moderation-labels] Processed ${successCount}/${labels.length} labels`);

      return jsonResponse({ ok: true, processed: successCount, total: labels.length, results });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const parsedLimit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
      const parsedOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
      const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
      const labelFilter = safeString(url.searchParams.get("label"));

      let query = supabase
        .from("moderation_labels")
        .select("*", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (labelFilter && VALID_USER_LABELS.has(labelFilter)) {
        query = query.eq("user_label", labelFilter);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error("[moderation-labels] Query error:", error);
        return jsonResponse({ ok: false, error: error.message }, 500);
      }

      const { data: statsData, error: statsError } = await supabase
        .from("moderation_labels")
        .select("user_label")
        .eq("user_id", user.id);

      if (statsError) {
        console.error("[moderation-labels] Stats query error:", statsError);
      }

      const stats = { shirtless: 0, swimwear: 0, other: 0, unsure: 0, total: 0 };
      statsData?.forEach((row: { user_label: string }) => {
        if (row.user_label in stats) {
          stats[row.user_label as keyof typeof stats] += 1;
        }
        stats.total += 1;
      });

      return jsonResponse({
        ok: true,
        labels: data || [],
        stats,
        count: count ?? data?.length ?? 0,
      });
    }

    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("[moderation-labels] Error:", e);
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      500,
    );
  }
});
