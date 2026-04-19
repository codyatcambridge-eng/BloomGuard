import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_HF_CHAT_BASE_URL = "https://router.huggingface.co/v1";
const DEFAULT_HF_CHAT_MODEL = "moonshotai/Kimi-K2-Instruct-0905";
const MAX_SYSTEM_PROMPT_LENGTH = 4000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CONTENT_LENGTH = 8000;

type ChatRole = "user" | "assistant";

interface WaitingRoomChatMessage {
  role: ChatRole;
  content: string;
}

interface WaitingRoomAiRequest {
  systemPrompt: string;
  messages: WaitingRoomChatMessage[];
  model?: string;
}

interface HfChatCompletionsResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function sanitizeModel(model: unknown): string | null {
  if (typeof model !== "string") return null;
  const trimmed = model.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) return null;
  return trimmed;
}

function parseRequestBody(raw: unknown): { ok: true; value: WaitingRoomAiRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid JSON payload" };
  }

  const body = raw as Partial<WaitingRoomAiRequest>;
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";

  if (!systemPrompt) {
    return { ok: false, error: "systemPrompt is required" };
  }
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return { ok: false, error: "systemPrompt is too long" };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: "messages must be a non-empty array" };
  }
  if (body.messages.length > MAX_MESSAGES) {
    return { ok: false, error: "Too many messages" };
  }

  const messages: WaitingRoomChatMessage[] = [];
  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") {
      return { ok: false, error: "Invalid message format" };
    }
    const role = (msg as { role?: unknown }).role;
    const content = (msg as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, error: "Invalid message role" };
    }
    if (typeof content !== "string") {
      return { ok: false, error: "Invalid message content" };
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { ok: false, error: "Message content cannot be empty" };
    }
    if (trimmedContent.length > MAX_MESSAGE_CONTENT_LENGTH) {
      return { ok: false, error: "Message content is too long" };
    }
    messages.push({ role, content: trimmedContent });
  }

  return {
    ok: true,
    value: {
      systemPrompt,
      messages,
      model: sanitizeModel(body.model) || undefined,
    },
  };
}

function extractAssistantMessage(data: HfChatCompletionsResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const textParts = content
    .map((item) => (typeof item?.text === "string" ? item.text : ""))
    .filter(Boolean);
  return textParts.join("\n").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const hfToken = Deno.env.get("HF_TOKEN");
    if (!hfToken) {
      console.error("[DIAG][WAITING_ROOM_AI] missing HF_TOKEN");
      return jsonResponse({ ok: false, error: "Server misconfigured" }, 500);
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON payload" }, 400);
    }

    const parsed = parseRequestBody(parsedBody);
    if (!parsed.ok) {
      return jsonResponse({ ok: false, error: parsed.error }, 400);
    }

    const baseUrl = (Deno.env.get("HF_CHAT_BASE_URL") || DEFAULT_HF_CHAT_BASE_URL).replace(/\/+$/, "");
    const model = parsed.value.model || Deno.env.get("HF_CHAT_MODEL") || DEFAULT_HF_CHAT_MODEL;
    const endpoint = `${baseUrl}/chat/completions`;
    const outboundMessages = [
      { role: "system", content: parsed.value.systemPrompt },
      ...parsed.value.messages,
    ];

    console.info("[DIAG][WAITING_ROOM_AI][REQUEST]", {
      model,
      systemPromptLength: parsed.value.systemPrompt.length,
      messageCount: outboundMessages.length,
    });

    const startedAt = nowMs();
    const hfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: outboundMessages,
      }),
    });
    const latencyMs = Math.round(nowMs() - startedAt);

    console.info("[DIAG][WAITING_ROOM_AI][RESPONSE]", {
      model,
      responseStatus: hfResponse.status,
      latencyMs,
    });

    if (!hfResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Upstream AI request failed",
          responseStatus: hfResponse.status,
          latencyMs,
        },
        502,
      );
    }

    const hfData = (await hfResponse.json()) as HfChatCompletionsResponse;
    const assistantMessage = extractAssistantMessage(hfData);
    if (!assistantMessage) {
      return jsonResponse({ ok: false, error: "Empty AI response" }, 502);
    }

    return jsonResponse({
      ok: true,
      assistantMessage,
      model: hfData.model || model,
      responseStatus: hfResponse.status,
      latencyMs,
    });
  } catch (error) {
    console.error("[DIAG][WAITING_ROOM_AI][ERROR]", {
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonResponse({ ok: false, error: "Internal error" }, 500);
  }
});
