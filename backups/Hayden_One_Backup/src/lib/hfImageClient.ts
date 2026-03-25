interface HfImageGenerationRequest {
  prompt: string;
  signal?: AbortSignal;
}

export interface HfImageGenerationResult {
  imageUrl: string;
  model: string;
  provider: string;
  status: number;
  latencyMs: number;
  usedFormat: 'b64_json' | 'url';
}

interface HfImagesApiResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

const DEFAULT_HF_ROUTER_ORIGIN = 'https://router.huggingface.co';
const DEFAULT_HF_IMAGE_PROVIDER = 'wavespeed';
const DEFAULT_HF_IMAGE_MODEL = 'black-forest-labs/FLUX.1-dev';

// Prototype-only safety note:
// FLUX.1-dev is licensed under a non-commercial / non-production license.
// Keep this integration disabled for production use until model licensing is approved.
export const HF_IMAGE_LICENSE_RISK_NOTE =
  'FLUX.1-dev uses a non-commercial / non-production license. Treat image generation as prototype-only.';

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

function resolveImageEndpoint(origin: string, provider: string): string {
  const normalizedOrigin = origin.replace(/\/+$/, '');
  const normalizedProvider = provider.replace(/^\/+|\/+$/g, '');
  return `${normalizedOrigin}/${normalizedProvider}/v1/images/generations`;
}

/**
 * Prototype-only direct client call for HF provider-routed image generation.
 * This is scaffolded only and intentionally not wired into auto-send chat paths.
 * Next secure step: move this call behind a Supabase edge-function proxy, matching chat.
 */
export async function requestHfGeneratedImage(
  request: HfImageGenerationRequest
): Promise<HfImageGenerationResult> {
  const token = readEnv('VITE_HF_TOKEN');
  const origin = readEnv('VITE_HF_ROUTER_ORIGIN') ?? DEFAULT_HF_ROUTER_ORIGIN;
  const provider = readEnv('VITE_HF_IMAGE_PROVIDER') ?? DEFAULT_HF_IMAGE_PROVIDER;
  const model = readEnv('VITE_HF_IMAGE_MODEL') ?? DEFAULT_HF_IMAGE_MODEL;

  if (!token) {
    throw new Error('Hugging Face token is missing. Set VITE_HF_TOKEN.');
  }

  const endpoint = resolveImageEndpoint(origin, provider);
  console.info('[DIAG][HF_IMAGE][REQUEST]', {
    model,
    provider,
    promptLength: request.prompt.length,
  });

  const startedAt = nowMs();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      prompt: request.prompt,
      response_format: 'b64_json',
    }),
    signal: request.signal,
  });
  const latencyMs = Math.round(nowMs() - startedAt);

  console.info('[DIAG][HF_IMAGE][RESPONSE]', {
    model,
    provider,
    status: response.status,
    latencyMs,
  });

  if (!response.ok) {
    throw new Error(`HF image request failed with status ${response.status}`);
  }

  const data = (await response.json()) as HfImagesApiResponse;
  const first = data.data?.[0];
  const b64Image = first?.b64_json?.trim();
  const urlImage = first?.url?.trim();

  if (b64Image) {
    return {
      imageUrl: `data:image/png;base64,${b64Image}`,
      model,
      provider,
      status: response.status,
      latencyMs,
      usedFormat: 'b64_json',
    };
  }

  if (urlImage) {
    return {
      imageUrl: urlImage,
      model,
      provider,
      status: response.status,
      latencyMs,
      usedFormat: 'url',
    };
  }

  throw new Error('HF image response did not include image data');
}
