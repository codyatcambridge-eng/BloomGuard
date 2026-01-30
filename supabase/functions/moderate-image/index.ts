import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ModerationRequest {
  imageUrl?: string;
  imageBase64?: string;
  sensitivity?: 'strict' | 'moderate' | 'relaxed';
}

interface ModerationResult {
  shouldBlur: boolean;
  classification: string;
  confidence: number;
  categories: string[];
  reason: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { imageUrl, imageBase64, sensitivity = 'strict' }: ModerationRequest = await req.json();

    if (!imageUrl && !imageBase64) {
      return new Response(
        JSON.stringify({ error: "Either imageUrl or imageBase64 is required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Moderating image with sensitivity: ${sensitivity}`);

    // Build the image content for the AI
    const imageContent = imageBase64 
      ? { type: "image_url", image_url: { url: imageBase64 } }
      : { type: "image_url", image_url: { url: imageUrl } };

    // Define sensitivity-based prompts
    const sensitivityPrompts = {
      strict: `You are a content moderation AI. Analyze this image and determine if it should be blurred for family-safe viewing.

BLUR if the image contains ANY of:
- Shirtless individuals (any gender)
- Swimwear or revealing clothing
- Suggestive poses or expressions
- Explicit or adult content
- Violence or gore
- Disturbing imagery
- Dating app style photos
- Underwear visible

DO NOT BLUR:
- Fully clothed individuals
- Nature, landscapes, objects
- Professional/business settings
- Family-friendly content

Respond with JSON only:
{
  "shouldBlur": true/false,
  "classification": "safe" | "suggestive" | "explicit" | "violent",
  "confidence": 0.0-1.0,
  "categories": ["category1", "category2"],
  "reason": "Brief explanation"
}`,
      moderate: `You are a content moderation AI. Analyze this image for explicit adult content.

BLUR if the image contains:
- Explicit nudity
- Sexual content
- Graphic violence
- Disturbing/shocking content

DO NOT BLUR:
- Swimwear (unless sexually suggestive)
- Fitness/athletic wear
- Normal beach photos
- Shirtless in appropriate context (sports, beach)

Respond with JSON only:
{
  "shouldBlur": true/false,
  "classification": "safe" | "suggestive" | "explicit" | "violent",
  "confidence": 0.0-1.0,
  "categories": ["category1", "category2"],
  "reason": "Brief explanation"
}`,
      relaxed: `You are a content moderation AI. Only flag explicit adult content.

BLUR only if the image contains:
- Explicit nudity
- Pornographic content
- Extreme violence/gore

Respond with JSON only:
{
  "shouldBlur": true/false,
  "classification": "safe" | "suggestive" | "explicit" | "violent",
  "confidence": 0.0-1.0,
  "categories": ["category1", "category2"],
  "reason": "Brief explanation"
}`
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: sensitivityPrompts[sensitivity] },
              imageContent
            ]
          }
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;

    if (!aiResponse) {
      throw new Error("No response from AI");
    }

    console.log("AI Response:", aiResponse);

    // Parse the JSON response from AI
    let result: ModerationResult;
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      // Default to safe if we can't parse
      result = {
        shouldBlur: false,
        classification: "unknown",
        confidence: 0,
        categories: [],
        reason: "Failed to analyze image"
      };
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in moderate-image:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
