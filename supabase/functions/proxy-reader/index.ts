const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Tags to completely remove (including content)
const REMOVE_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 
  'applet', 'noscript', 'template', 'svg', 'canvas', 'video', 'audio',
  'map', 'area'
];

// Form elements to remove
const FORM_TAGS = ['form', 'input', 'button', 'select', 'textarea', 'label'];

// Tracking patterns to filter
const TRACKING_PATTERNS = [
  /google-analytics/i,
  /googletagmanager/i,
  /facebook.*pixel/i,
  /analytics/i,
  /tracker/i,
  /beacon/i,
  /doubleclick/i,
  /adsense/i,
  /adsbygoogle/i,
  /\.gif\?/i, // tracking pixels
  /1x1/i, // 1x1 tracking pixels
  /pixel\./i,
];

function cleanHtml(html: string, baseUrl: string): { content: string; images: string[]; title: string; description: string } {
  const images: string[] = [];
  let title = '';
  let description = '';

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = decodeHtmlEntities(titleMatch[1].trim());
  }

  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i);
  if (descMatch) {
    description = decodeHtmlEntities(descMatch[1].trim());
  }

  // Remove comments
  let cleaned = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove tags with their content
  for (const tag of REMOVE_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    cleaned = cleaned.replace(regex, '');
    // Self-closing
    const selfClosing = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    cleaned = cleaned.replace(selfClosing, '');
  }

  // Remove form elements
  for (const tag of FORM_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    cleaned = cleaned.replace(regex, '');
    const selfClosing = new RegExp(`<${tag}[^>]*\\/?>`, 'gi');
    cleaned = cleaned.replace(selfClosing, '');
  }

  // Remove inline event handlers
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: URLs
  cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  // Remove data: URLs (potential XSS)
  cleaned = cleaned.replace(/src\s*=\s*["']data:(?!image)[^"']*["']/gi, 'src=""');

  // Remove link tags
  cleaned = cleaned.replace(/<link[^>]*>/gi, '');

  // Remove meta refresh
  cleaned = cleaned.replace(/<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/gi, '');

  // Extract and process images before removing tracking elements
  const imgRegex = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(cleaned)) !== null) {
    let imgSrc = match[1];
    
    // Skip tracking pixels and tiny images
    if (TRACKING_PATTERNS.some(p => p.test(imgSrc))) continue;
    if (imgSrc.includes('spacer')) continue;
    if (imgSrc.includes('blank.')) continue;
    
    // Convert relative URLs to absolute
    imgSrc = resolveUrl(imgSrc, baseUrl);
    
    if (imgSrc && !images.includes(imgSrc)) {
      images.push(imgSrc);
    }
  }

  // Update image src to absolute URLs
  cleaned = cleaned.replace(
    /<img([^>]*)src\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    (match, before, src, after) => {
      const absoluteSrc = resolveUrl(src, baseUrl);
      return `<img${before}src="${absoluteSrc}"${after}>`;
    }
  );

  // Try to extract main content
  let mainContent = extractMainContent(cleaned);

  // Clean up whitespace
  mainContent = mainContent
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .trim();

  // Remove empty tags
  mainContent = mainContent.replace(/<(\w+)[^>]*>\s*<\/\1>/g, '');
  
  // Remove hidden elements
  mainContent = mainContent.replace(/<[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|hidden\s*=)[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Add paragraph breaks for readability
  mainContent = mainContent
    .replace(/<\/p>\s*<p/gi, '</p>\n<p')
    .replace(/<br\s*\/?>/gi, '<br>\n')
    .replace(/<\/h([1-6])>/gi, '</h$1>\n')
    .replace(/<\/li>/gi, '</li>\n');

  return {
    content: mainContent,
    images,
    title,
    description,
  };
}

function extractMainContent(html: string): string {
  // Priority order for content extraction
  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:content|article|post|entry|story|text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:body|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const selector of contentSelectors) {
    const match = html.match(selector);
    if (match && match[1] && match[1].length > 200) {
      return match[1];
    }
  }

  // Fallback: get body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    let body = bodyMatch[1];
    
    // Remove common non-content sections
    body = body.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    body = body.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    body = body.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    body = body.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    body = body.replace(/<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:sidebar|menu|nav|header|footer|ad|banner|comment|social|share|related)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    
    return body;
  }

  return html;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  try {
    const base = new URL(baseUrl);
    
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    
    if (url.startsWith('/')) {
      return base.origin + url;
    }
    
    return new URL(url, base.href).href;
  } catch {
    return url;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

Deno.serve(async (req) => {
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

    // Fetch the page with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    const { content, images, title, description } = cleanHtml(html, url);

    console.log('[proxy-reader] Extracted content length:', content.length);
    console.log('[proxy-reader] Found images:', images.length);
    console.log('[proxy-reader] Title:', title);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          content,
          images,
          title: title || new URL(url).hostname,
          description,
          sourceUrl: url,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[proxy-reader] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process page';
    
    if (errorMessage.includes('abort')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Request timed out' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});