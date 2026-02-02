const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Tags to completely remove (including content)
const REMOVE_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 
  'applet', 'noscript', 'template', 'svg', 'canvas', 'video', 'audio',
  'map', 'area', 'base', 'meta'
];

// Form elements to remove
const FORM_TAGS = ['form', 'input', 'button', 'select', 'textarea', 'label', 'fieldset'];

// Tracking and junk patterns to filter
const TRACKING_PATTERNS = [
  /google-analytics/i,
  /googletagmanager/i,
  /facebook.*pixel/i,
  /fbevents/i,
  /analytics/i,
  /tracker/i,
  /beacon/i,
  /doubleclick/i,
  /adsense/i,
  /adsbygoogle/i,
  /\.gif\?/i,
  /1x1/i,
  /pixel\./i,
  /tracking/i,
  /hotjar/i,
  /mixpanel/i,
  /segment\./i,
  /clarity\./i,
  /intercom/i,
  /crisp/i,
  /tawk\./i,
  /livechat/i,
  /zendesk/i,
  /hubspot/i,
  /optimizely/i,
  /abtasty/i,
  /amplitude/i,
  /fullstory/i,
  /logrocket/i,
  /sentry/i,
  /bugsnag/i,
  /rollbar/i,
];

// Junk image patterns (tracking pixels, spacers, etc.)
const JUNK_IMAGE_PATTERNS = [
  /spacer/i,
  /blank\./i,
  /pixel\./i,
  /1x1/i,
  /transparent\./i,
  /clear\./i,
  /shim\./i,
  /dot\./i,
  /loading.*spinner/i,
  /loader\./i,
  /placeholder/i,
  /data:image\/gif;base64,R0lGOD/i, // 1x1 transparent GIF
];

function cleanHtml(html: string, baseUrl: string): { content: string; images: string[]; title: string; description: string } {
  const images: string[] = [];
  let title = '';
  let description = '';

  console.log('[proxy-reader] Starting HTML cleanup, input length:', html.length);

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

  // Remove comments first
  let cleaned = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove CDATA sections
  cleaned = cleaned.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

  // Remove tags with their content
  for (const tag of REMOVE_TAGS) {
    // Match both regular and self-closing tags with content
    const regex = new RegExp(`<${tag}[^>]*>(?:[\\s\\S]*?<\\/${tag}>)?`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Remove form elements
  for (const tag of FORM_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>(?:[\\s\\S]*?<\\/${tag}>)?`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Remove inline event handlers
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: and vbscript: URLs
  cleaned = cleaned.replace(/href\s*=\s*["'](javascript|vbscript):[^"']*["']/gi, 'href="#"');

  // Remove data: URLs (except safe images)
  cleaned = cleaned.replace(/src\s*=\s*["']data:(?!image\/(png|jpeg|jpg|gif|webp|svg\+xml))[^"']*["']/gi, 'src=""');

  // Remove link and base tags
  cleaned = cleaned.replace(/<link[^>]*>/gi, '');
  cleaned = cleaned.replace(/<base[^>]*>/gi, '');

  // Remove meta refresh
  cleaned = cleaned.replace(/<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/gi, '');

  // Extract and process images before removing tracking elements
  const imgRegex = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(cleaned)) !== null) {
    let imgSrc = match[1];
    
    // Skip tracking pixels and junk images
    if (TRACKING_PATTERNS.some(p => p.test(imgSrc))) continue;
    if (JUNK_IMAGE_PATTERNS.some(p => p.test(imgSrc))) continue;
    if (imgSrc.length < 10) continue; // Skip very short URLs
    
    // Convert relative URLs to absolute
    imgSrc = resolveUrl(imgSrc, baseUrl);
    
    if (imgSrc && imgSrc.startsWith('http') && !images.includes(imgSrc)) {
      images.push(imgSrc);
    }
  }

  console.log('[proxy-reader] Found valid images:', images.length);

  // Update image src to absolute URLs
  cleaned = cleaned.replace(
    /<img([^>]*)src\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    (match, before, src, after) => {
      // Skip tracking/junk images entirely
      if (TRACKING_PATTERNS.some(p => p.test(src)) || JUNK_IMAGE_PATTERNS.some(p => p.test(src))) {
        return '';
      }
      const absoluteSrc = resolveUrl(src, baseUrl);
      return `<img${before}src="${absoluteSrc}"${after}>`;
    }
  );

  // Update anchor hrefs to absolute URLs
  cleaned = cleaned.replace(
    /<a([^>]*)href\s*=\s*["']([^"'#][^"']*)["']([^>]*)>/gi,
    (match, before, href, after) => {
      if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return match;
      }
      const absoluteHref = resolveUrl(href, baseUrl);
      return `<a${before}href="${absoluteHref}" target="_blank" rel="noopener noreferrer"${after}>`;
    }
  );

  // Try to extract main content
  let mainContent = extractMainContent(cleaned);

  // Clean up whitespace aggressively
  mainContent = mainContent
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .trim();

  // Remove empty tags iteratively
  let prevLength = 0;
  while (prevLength !== mainContent.length) {
    prevLength = mainContent.length;
    mainContent = mainContent.replace(/<(\w+)[^>]*>\s*<\/\1>/g, '');
  }
  
  // Remove hidden elements
  mainContent = mainContent.replace(/<[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|aria-hidden\s*=\s*["']true["'])[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Add paragraph breaks for readability
  mainContent = mainContent
    .replace(/<\/p>\s*<p/gi, '</p>\n\n<p')
    .replace(/<br\s*\/?>/gi, '<br>\n')
    .replace(/<\/h([1-6])>/gi, '</h$1>\n\n')
    .replace(/<\/li>/gi, '</li>\n')
    .replace(/<\/div>/gi, '</div>\n');

  console.log('[proxy-reader] Final content length:', mainContent.length);

  return {
    content: mainContent,
    images: images.slice(0, 50), // Limit to 50 images max
    title,
    description,
  };
}

function extractMainContent(html: string): string {
  // Priority order for content extraction
  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:content|article|post|entry|story|text|body-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:body|main|wrapper|container)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*(?:class|id)\s*=\s*["'][^"']*(?:content|article|main)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  ];

  for (const selector of contentSelectors) {
    const match = html.match(selector);
    if (match && match[1] && match[1].length > 200) {
      console.log('[proxy-reader] Found content using selector, length:', match[1].length);
      return match[1];
    }
  }

  // Fallback: get body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    let body = bodyMatch[1];
    
    // Remove common non-content sections
    const removePatterns = [
      /<header[^>]*>[\s\S]*?<\/header>/gi,
      /<footer[^>]*>[\s\S]*?<\/footer>/gi,
      /<nav[^>]*>[\s\S]*?<\/nav>/gi,
      /<aside[^>]*>[\s\S]*?<\/aside>/gi,
      /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:sidebar|menu|nav|header|footer|ad|banner|comment|social|share|related|cookie|popup|modal|overlay|newsletter|subscribe)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    ];
    
    for (const pattern of removePatterns) {
      body = body.replace(pattern, '');
    }
    
    console.log('[proxy-reader] Using body content, length:', body.length);
    return body;
  }

  console.log('[proxy-reader] No body found, returning full HTML');
  return html;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (!url || url.startsWith('data:')) return url;
  
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
  } catch (e) {
    console.warn('[proxy-reader] Failed to resolve URL:', url);
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
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const MIN_CONTENT_LENGTH = 100;
const REQUEST_TIMEOUT = 10000; // 10 seconds

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    let url: string;
    
    try {
      const body = await req.json();
      url = body?.url;
    } catch (e) {
      console.error('[proxy-reader] Failed to parse request body:', e);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid URL format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[proxy-reader] Fetching URL:', url);

    // Fetch the page with strict timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('[proxy-reader] Request timeout triggered');
      controller.abort();
    }, REQUEST_TIMEOUT);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error('[proxy-reader] Fetch failed:', response.status, response.statusText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Failed to fetch page: ${response.status} ${response.statusText}` 
        }),
        { status: response.status >= 500 ? 502 : response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      console.warn('[proxy-reader] Non-HTML content type:', contentType);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'This page is not HTML content and cannot be displayed in Reader Mode.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let html: string;
    try {
      html = await response.text();
    } catch (e) {
      console.error('[proxy-reader] Failed to read response body:', e);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to read page content' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[proxy-reader] Received HTML, length:', html.length);

    if (html.length < 100) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Page content is too short or empty.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean and extract content
    let result: { content: string; images: string[]; title: string; description: string };
    try {
      result = cleanHtml(html, url);
    } catch (e) {
      console.error('[proxy-reader] Failed to clean HTML:', e);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to process page content' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { content, images, title, description } = result;

    // Check minimum content length
    const textContent = content.replace(/<[^>]+>/g, '').trim();
    if (textContent.length < MIN_CONTENT_LENGTH) {
      console.warn('[proxy-reader] Content too short:', textContent.length);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Reader Mode failed. No readable content found on this page.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const processingTime = Date.now() - startTime;
    console.log('[proxy-reader] Success:', {
      contentLength: content.length,
      textLength: textContent.length,
      imageCount: images.length,
      title: title.substring(0, 50),
      processingTime: processingTime + 'ms',
    });

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
    const errorMessage = error instanceof Error ? error.message : 'Failed to process page';
    console.error('[proxy-reader] Error:', errorMessage);
    
    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Request timed out. The page took too long to load.' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: 'Reader Mode failed. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});