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

interface CleanResult {
  content: string;
  images: string[];
  title: string;
  description: string;
  previewHtml?: string; // Sanitized full HTML for Preview Mode
}

function cleanHtml(html: string, baseUrl: string): CleanResult {
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

  // Also try og:description
  if (!description) {
    const ogDescMatch = html.match(/<meta[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)["']/i);
    if (ogDescMatch) {
      description = decodeHtmlEntities(ogDescMatch[1].trim());
    }
  }

  // Remove comments first
  let cleaned = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove CDATA sections
  cleaned = cleaned.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

  // Remove tags with their content
  for (const tag of REMOVE_TAGS) {
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
    if (imgSrc.length < 10) continue;
    
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

  // Create sanitized Preview HTML (full page structure for Preview Mode)
  const previewHtml = createPreviewHtml(cleaned, title, description, images.slice(0, 10));

  // Try to extract main content for Reader Mode
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
    images: images.slice(0, 50),
    title,
    description,
    previewHtml,
  };
}

function createPreviewHtml(html: string, title: string, description: string, topImages: string[]): string {
  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1] : html;
  
  // Limit content length for preview
  if (bodyContent.length > 100000) {
    bodyContent = bodyContent.substring(0, 100000) + '...';
  }
  
  // Build a minimal preview structure
  const previewContent = `
    <div class="preview-container" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e0e0e0; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 16px;">
      ${title ? `<h1 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 8px; color: #fff;">${escapeHtml(title)}</h1>` : ''}
      ${description ? `<p style="color: #888; font-size: 0.9rem; margin-bottom: 16px; font-style: italic;">${escapeHtml(description)}</p>` : ''}
      ${topImages.length > 0 ? `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 16px;">
          ${topImages.map(img => `<img src="${img}" style="width: 100%; height: auto; border-radius: 8px; object-fit: cover;" loading="lazy" onerror="this.style.display='none'" />`).join('')}
        </div>
      ` : ''}
      <div class="preview-body" style="opacity: 0.9;">
        ${bodyContent}
      </div>
    </div>
  `;
  
  return previewContent;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractMainContent(html: string): string {
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

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    let body = bodyMatch[1];
    
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

function isPdfUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.pdf') || lowerUrl.includes('.pdf?') || lowerUrl.includes('.pdf#');
}

// YouTube URL detection and video ID extraction
function isYouTubeUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return hostname.includes('youtube.com') || hostname.includes('youtu.be');
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    
    // Handle youtu.be short URLs
    if (urlObj.hostname.includes('youtu.be')) {
      return urlObj.pathname.slice(1).split('?')[0] || null;
    }
    
    // Handle youtube.com URLs
    if (urlObj.hostname.includes('youtube.com')) {
      // /watch?v=VIDEO_ID
      const vParam = urlObj.searchParams.get('v');
      if (vParam) return vParam;
      
      // /embed/VIDEO_ID or /v/VIDEO_ID
      const pathMatch = urlObj.pathname.match(/\/(embed|v)\/([^/?]+)/);
      if (pathMatch) return pathMatch[2];
      
      // /shorts/VIDEO_ID
      const shortsMatch = urlObj.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
    
    return null;
  } catch {
    return null;
  }
}

interface YouTubeMetadata {
  videoId: string;
  title: string;
  channelName: string;
  description: string;
  thumbnailUrl: string;
  error?: string;
}

const MAX_RESPONSE_SIZE = 500 * 1024; // 500KB limit
const YOUTUBE_TIMEOUT = 10000; // 10 second timeout

async function fetchYouTubeMetadata(videoId: string, url: string): Promise<YouTubeMetadata> {
  console.log('[proxy-reader] Fetching YouTube metadata for videoId:', videoId, 'url:', url);
  
  // Use hqdefault as fallback (always available), maxresdefault may not exist
  const defaultMeta: YouTubeMetadata = {
    videoId,
    title: 'YouTube Video',
    channelName: 'Unknown Channel',
    description: '',
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  };
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('[proxy-reader] YouTube fetch timeout triggered');
      controller.abort();
    }, YOUTUBE_TIMEOUT);
    
    // Use oembed API first - more reliable and doesn't get blocked
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    console.log('[proxy-reader] Trying oEmbed API:', oembedUrl);
    
    try {
      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; SafeBrowser/1.0)',
        },
        signal: controller.signal,
      });
      
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        console.log('[proxy-reader] oEmbed success:', {
          title: oembedData.title?.substring(0, 50),
          author: oembedData.author_name,
        });
        
        clearTimeout(timeoutId);
        
        return {
          videoId,
          title: oembedData.title || defaultMeta.title,
          channelName: oembedData.author_name || defaultMeta.channelName,
          description: '', // oEmbed doesn't include description
          thumbnailUrl: oembedData.thumbnail_url || defaultMeta.thumbnailUrl,
        };
      } else {
        console.warn('[proxy-reader] oEmbed failed:', oembedResponse.status);
      }
    } catch (oembedError) {
      console.warn('[proxy-reader] oEmbed error:', oembedError);
    }
    
    // Fallback: fetch the actual page for description
    console.log('[proxy-reader] Falling back to page fetch for description');
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // Log response details for debugging
    console.log('[proxy-reader] YouTube page response:', {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
    });
    
    // Handle bot walls and blocks
    if (response.status === 403 || response.status === 429) {
      console.error('[proxy-reader] YouTube blocked request:', response.status);
      return {
        ...defaultMeta,
        error: 'youtube_metadata_blocked',
      };
    }
    
    if (!response.ok) {
      console.warn('[proxy-reader] YouTube page fetch failed:', response.status);
      return {
        ...defaultMeta,
        error: `youtube_fetch_error_${response.status}`,
      };
    }
    
    // Check for redirect to consent page
    const finalUrl = response.url;
    if (finalUrl.includes('consent.youtube') || finalUrl.includes('consent.google')) {
      console.warn('[proxy-reader] YouTube consent wall detected');
      return {
        ...defaultMeta,
        error: 'youtube_consent_required',
      };
    }
    
    // Limit response size
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      console.warn('[proxy-reader] YouTube response too large:', contentLength);
    }
    
    // Read response with size limit
    const reader = response.body?.getReader();
    if (!reader) {
      return defaultMeta;
    }
    
    let html = '';
    let totalSize = 0;
    const decoder = new TextDecoder();
    
    while (totalSize < MAX_RESPONSE_SIZE) {
      const { done, value } = await reader.read();
      if (done) break;
      
      totalSize += value.length;
      html += decoder.decode(value, { stream: true });
      
      // Early exit if we have enough content (meta tags are in head)
      if (html.includes('</head>') && totalSize > 50000) {
        console.log('[proxy-reader] Got head section, stopping early');
        break;
      }
    }
    
    reader.cancel();
    console.log('[proxy-reader] Read', totalSize, 'bytes from YouTube page');
    
    // Try JSON-LD extraction first (most reliable)
    const jsonLdMatch = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        console.log('[proxy-reader] Found JSON-LD data');
        
        if (jsonLd['@type'] === 'VideoObject' || jsonLd.name) {
          defaultMeta.title = jsonLd.name || defaultMeta.title;
          defaultMeta.description = jsonLd.description || defaultMeta.description;
          defaultMeta.thumbnailUrl = jsonLd.thumbnailUrl?.[0] || jsonLd.thumbnail?.url || defaultMeta.thumbnailUrl;
          
          if (jsonLd.author?.name) {
            defaultMeta.channelName = jsonLd.author.name;
          }
        }
      } catch (e) {
        console.warn('[proxy-reader] JSON-LD parse failed:', e);
      }
    }
    
    // Try ytInitialPlayerResponse for more data
    const playerResponseMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/);
    if (playerResponseMatch) {
      try {
        const playerData = JSON.parse(playerResponseMatch[1]);
        const videoDetails = playerData?.videoDetails;
        
        if (videoDetails) {
          console.log('[proxy-reader] Found ytInitialPlayerResponse');
          defaultMeta.title = videoDetails.title || defaultMeta.title;
          defaultMeta.channelName = videoDetails.author || defaultMeta.channelName;
          defaultMeta.description = videoDetails.shortDescription || defaultMeta.description;
          
          // Get best thumbnail
          const thumbnails = videoDetails.thumbnail?.thumbnails;
          if (thumbnails && thumbnails.length > 0) {
            // Get highest quality thumbnail
            const bestThumb = thumbnails.reduce((best: any, curr: any) => 
              (curr.width > (best.width || 0)) ? curr : best, {});
            if (bestThumb.url) {
              defaultMeta.thumbnailUrl = bestThumb.url;
            }
          }
        }
      } catch (e) {
        console.warn('[proxy-reader] ytInitialPlayerResponse parse failed:', e);
      }
    }
    
    // Fallback to meta tags if still missing data
    if (defaultMeta.title === 'YouTube Video') {
      const ogTitleMatch = html.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i);
      if (ogTitleMatch) {
        defaultMeta.title = decodeHtmlEntities(ogTitleMatch[1].trim());
      } else {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          defaultMeta.title = decodeHtmlEntities(titleMatch[1].replace(' - YouTube', '').trim());
        }
      }
    }
    
    if (defaultMeta.channelName === 'Unknown Channel') {
      // Try multiple patterns for channel name
      const channelPatterns = [
        /"ownerChannelName"\s*:\s*"([^"]+)"/,
        /"author"\s*:\s*"([^"]+)"/,
        /itemprop\s*=\s*["']author["'][^>]*content\s*=\s*["']([^"']+)["']/i,
        /<link[^>]*itemprop\s*=\s*["']name["'][^>]*content\s*=\s*["']([^"']+)["']/i,
        /"channelName"\s*:\s*"([^"]+)"/,
      ];
      
      for (const pattern of channelPatterns) {
        const match = html.match(pattern);
        if (match) {
          defaultMeta.channelName = decodeHtmlEntities(match[1].trim());
          break;
        }
      }
    }
    
    if (!defaultMeta.description) {
      const ogDescMatch = html.match(/<meta[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:description["']/i);
      if (ogDescMatch) {
        defaultMeta.description = decodeHtmlEntities(ogDescMatch[1].trim());
      }
    }
    
    // Get og:image if thumbnail still default
    if (defaultMeta.thumbnailUrl.includes('hqdefault.jpg')) {
      const ogImageMatch = html.match(/<meta[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)
        || html.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i);
      if (ogImageMatch) {
        defaultMeta.thumbnailUrl = ogImageMatch[1];
      }
    }
    
    console.log('[proxy-reader] YouTube metadata extraction complete:', {
      videoId,
      title: defaultMeta.title.substring(0, 50),
      channelName: defaultMeta.channelName,
      hasDescription: defaultMeta.description.length > 0,
      thumbnailUrl: defaultMeta.thumbnailUrl.substring(0, 60),
    });
    
    return defaultMeta;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[proxy-reader] YouTube metadata fetch error:', errorMsg);
    
    if (errorMsg.includes('abort')) {
      return {
        ...defaultMeta,
        error: 'youtube_timeout',
      };
    }
    
    return {
      ...defaultMeta,
      error: 'youtube_fetch_failed',
    };
  }
}

const MIN_CONTENT_LENGTH = 100;
const REQUEST_TIMEOUT = 10000;

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

    // Check if URL is a PDF
    if (isPdfUrl(url)) {
      console.log('[proxy-reader] PDF detected:', url);
      return new Response(
        JSON.stringify({
          success: true,
          isPdf: true,
          data: {
            pdfUrl: url,
            title: url.split('/').pop()?.replace('.pdf', '') || 'PDF Document',
            sourceUrl: url,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if URL is YouTube - handle specially
    if (isYouTubeUrl(url)) {
      const videoId = extractYouTubeVideoId(url);
      console.log('[proxy-reader] YouTube detected, videoId:', videoId);
      
      if (videoId) {
        const metadata = await fetchYouTubeMetadata(videoId, url);
        return new Response(
          JSON.stringify({
            success: true,
            isYouTube: true,
            data: {
              videoId: metadata.videoId,
              title: metadata.title,
              channelName: metadata.channelName,
              description: metadata.description,
              thumbnailUrl: metadata.thumbnailUrl,
              sourceUrl: url,
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('[proxy-reader] Fetching URL:', url);

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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
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
    
    // Handle PDF content type
    if (contentType.includes('application/pdf')) {
      console.log('[proxy-reader] PDF content type detected');
      return new Response(
        JSON.stringify({
          success: true,
          isPdf: true,
          data: {
            pdfUrl: url,
            title: url.split('/').pop()?.replace('.pdf', '') || 'PDF Document',
            sourceUrl: url,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      console.warn('[proxy-reader] Non-HTML content type:', contentType);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `This page type (${contentType.split(';')[0]}) cannot be displayed in Reader Mode.`,
          contentType: contentType.split(';')[0],
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
    let result: CleanResult;
    try {
      result = cleanHtml(html, url);
    } catch (e) {
      console.error('[proxy-reader] Failed to clean HTML:', e);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to process page content' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { content, images, title, description, previewHtml } = result;

    // Check minimum content length for Reader Mode
    const textContent = content.replace(/<[^>]+>/g, '').trim();
    const hasReadableContent = textContent.length >= MIN_CONTENT_LENGTH;
    
    if (!hasReadableContent) {
      console.warn('[proxy-reader] Content too short for Reader Mode:', textContent.length);
      // Still return success but indicate Preview Mode should be used
      return new Response(
        JSON.stringify({ 
          success: true,
          readerModeFailed: true,
          data: {
            content: '',
            previewHtml: previewHtml || '',
            images,
            title: title || new URL(url).hostname,
            description,
            sourceUrl: url,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          previewHtml,
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
