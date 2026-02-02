const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Tags and attributes to strip for security
const DANGEROUS_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea'];
const TRACKING_PATTERNS = [
  /google-analytics/i,
  /googletagmanager/i,
  /facebook.*pixel/i,
  /analytics/i,
  /tracker/i,
  /beacon/i,
  /doubleclick/i,
  /adsense/i,
];

function cleanHtml(html: string, baseUrl: string): { content: string; images: string[]; title: string } {
  const images: string[] = [];
  let title = '';

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Remove dangerous tags completely
  let cleaned = html;
  for (const tag of DANGEROUS_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'gi');
    cleaned = cleaned.replace(regex, '');
    // Also remove self-closing versions
    const selfClosingRegex = new RegExp(`<${tag}[^>]*\/>`, 'gi');
    cleaned = cleaned.replace(selfClosingRegex, '');
  }

  // Remove inline event handlers
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: URLs
  cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  // Remove tracking pixels and beacons
  for (const pattern of TRACKING_PATTERNS) {
    cleaned = cleaned.replace(new RegExp(`<[^>]*${pattern.source}[^>]*>`, 'gi'), '');
  }

  // Remove style tags (can contain expressions)
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove link tags (external resources)
  cleaned = cleaned.replace(/<link[^>]*>/gi, '');

  // Remove meta refresh
  cleaned = cleaned.replace(/<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/gi, '');

  // Remove noscript content
  cleaned = cleaned.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Extract and process images
  const imgRegex = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(cleaned)) !== null) {
    let imgSrc = match[1];
    // Convert relative URLs to absolute
    if (imgSrc.startsWith('//')) {
      imgSrc = 'https:' + imgSrc;
    } else if (imgSrc.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        imgSrc = base.origin + imgSrc;
      } catch {
        // Keep original
      }
    } else if (!imgSrc.startsWith('http')) {
      try {
        const base = new URL(baseUrl);
        imgSrc = new URL(imgSrc, base.href).href;
      } catch {
        // Keep original
      }
    }
    
    // Skip tracking pixels and tiny images
    if (!TRACKING_PATTERNS.some(p => p.test(imgSrc))) {
      images.push(imgSrc);
    }
  }

  // Try to extract main content (simplified readability)
  let mainContent = cleaned;
  
  // Look for article or main content
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const contentMatch = cleaned.match(/<div[^>]*class\s*=\s*["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  
  if (articleMatch) {
    mainContent = articleMatch[1];
  } else if (mainMatch) {
    mainContent = mainMatch[1];
  } else if (contentMatch) {
    mainContent = contentMatch[1];
  } else {
    // Try to get body content
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      mainContent = bodyMatch[1];
    }
  }

  // Remove excessive whitespace
  mainContent = mainContent.replace(/\s+/g, ' ').trim();

  // Remove empty tags
  mainContent = mainContent.replace(/<(\w+)[^>]*>\s*<\/\1>/g, '');

  // Remove hidden elements
  mainContent = mainContent.replace(/<[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Basic sanitization of remaining HTML
  // Allow only safe tags
  const allowedTags = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'strong', 'em', 'b', 'i', 'u', 'div', 'span', 'article', 'section', 'header', 'footer', 'nav', 'figure', 'figcaption', 'pre', 'code', 'table', 'tr', 'td', 'th', 'thead', 'tbody'];
  
  // Keep href and src attributes for links and images
  const allowedAttrs = ['href', 'src', 'alt', 'title', 'class', 'id'];

  return {
    content: mainContent,
    images: [...new Set(images)], // Dedupe
    title,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[proxy-reader] Fetching URL:', url);

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SafeBrowserReader/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      console.error('[proxy-reader] Fetch failed:', response.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Failed to fetch page: ${response.status} ${response.statusText}` 
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();
    console.log('[proxy-reader] Received HTML, length:', html.length);

    // Clean and extract content
    const { content, images, title } = cleanHtml(html, url);

    console.log('[proxy-reader] Extracted content length:', content.length);
    console.log('[proxy-reader] Found images:', images.length);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          content,
          images,
          title,
          sourceUrl: url,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[proxy-reader] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process page';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
