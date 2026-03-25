export type HfChatMessageRole = 'system' | 'user' | 'assistant';

export interface HfChatMessage {
  role: Exclude<HfChatMessageRole, 'system'>;
  content: string;
}

interface HfChatCompletionRequest {
  systemPrompt: string;
  messages: HfChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface HfChatCompletionResult {
  assistantMessage: string;
  model: string;
  status: number;
  latencyMs: number;
}

interface HfChatCompletionsResponse {
  ok?: boolean;
  assistantMessage?: string;
  model?: string;
  responseStatus?: number;
  latencyMs?: number;
  error?: string;
}

const DEFAULT_HF_CHAT_MODEL = 'moonshotai/Kimi-K2-Instruct-0905';
const WAITING_ROOM_AI_FUNCTION_PATH = '/functions/v1/waiting-room-ai';

function readEnv(name: string): string | undefined {
  const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
  const value = env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function resolveWaitingRoomAiUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}${WAITING_ROOM_AI_FUNCTION_PATH}`;
}

/**
 * Calls the secure Supabase edge-function proxy for Waiting Room AI.
 * Client never sends a Hugging Face token directly.
 */
export async function requestHfChatCompletion(
  request: HfChatCompletionRequest
): Promise<HfChatCompletionResult> {
  const baseUrl = readEnv('VITE_SUPABASE_URL');
  const anonKey = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
  const model = readEnv('VITE_HF_CHAT_MODEL') ?? DEFAULT_HF_CHAT_MODEL;

  if (!baseUrl) {
    throw new Error('Supabase URL is missing. Set VITE_SUPABASE_URL.');
  }
  if (!anonKey) {
    throw new Error('Supabase publishable key is missing. Set VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  const endpoint = resolveWaitingRoomAiUrl(baseUrl);
  const messageCount = request.messages.length + 1;

  console.info('[DIAG][HF_CHAT_PROXY][REQUEST]', {
    model,
    systemPromptLength: request.systemPrompt.length,
    messageCount,
  });

  const startedAt = nowMs();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      systemPrompt: request.systemPrompt,
      messages: request.messages,
      model,
    }),
    signal: request.signal,
  });
  const latencyMs = Math.round(nowMs() - startedAt);

  console.info('[DIAG][HF_CHAT_PROXY][RESPONSE]', {
    model,
    status: response.status,
    latencyMs,
  });

  let data: HfChatCompletionsResponse | null = null;
  try {
    data = (await response.json()) as HfChatCompletionsResponse;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Waiting Room AI proxy request failed with status ${response.status}`);
  }

  const assistantMessage = typeof data?.assistantMessage === 'string' ? data.assistantMessage.trim() : '';
  if (!assistantMessage) {
    throw new Error('Waiting Room AI proxy response was empty');
  }

  return {
    assistantMessage,
    model: data?.model ?? model,
    status: data?.responseStatus ?? response.status,
    latencyMs: data?.latencyMs ?? latencyMs,
  };
}
