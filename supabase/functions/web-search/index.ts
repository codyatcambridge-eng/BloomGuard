import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

interface SearchResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
  query?: string;
}

// Clean HTML entities and tags
function cleanText(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract image URL from result if available
function extractThumbnail(divContent: string): string | undefined {
  // Look for image URLs in the result
  const imgMatch = divContent.match(/src=["']([^"']+\.(jpg|jpeg|png|gif|webp)[^"']*)/i);
  if (imgMatch && imgMatch[1].startsWith('http')) {
    return imgMatch[1];
  }
  return undefined;
}

// Parse DuckDuckGo HTML search results with improved extraction
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  console.log('[web-search] Searching DuckDuckGo for:', query);
  
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
  
  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      console.error('[web-search] DuckDuckGo request failed:', response.status);
      throw new Error(`Search request failed: ${response.status}`);
    }

    const html = await response.text();
    console.log('[web-search] Received HTML length:', html.length);

    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();
    
    // Split by result containers
    const resultDivs = html.split(/class="result\s+results_links/i);
    console.log('[web-search] Found result divs:', resultDivs.length - 1);
    
    for (let i = 1; i < resultDivs.length && results.length < 10; i++) {
      const div = resultDivs[i];
      const divContent = div.substring(0, 4000);
      
      // Extract URL from uddg parameter
      const uddgMatch = divContent.match(/uddg=([^&"']+)/);
      if (!uddgMatch) continue;
      
      let url: string;
      try {
        url = decodeURIComponent(uddgMatch[1]);
        // Double decode if needed
        if (url.includes('%')) {
          url = decodeURIComponent(url);
        }
      } catch {
        continue;
      }
      
      // Clean URL - remove tracking parameters
      try {
        const urlObj = new URL(url);
        url = urlObj.origin + urlObj.pathname;
        // Keep essential query params
        const keepParams = ['q', 'id', 'p', 'page'];
        const newParams = new URLSearchParams();
        urlObj.searchParams.forEach((value, key) => {
          if (keepParams.includes(key.toLowerCase())) {
            newParams.set(key, value);
          }
        });
        if (newParams.toString()) {
          url += '?' + newParams.toString();
        }
      } catch {
        // Keep original if parsing fails
      }
      
      // Skip non-http URLs, duckduckgo, and duplicates
      if (!url.startsWith('http') || url.includes('duckduckgo') || seenUrls.has(url)) {
        continue;
      }
      seenUrls.add(url);
      
      // Extract title - try multiple patterns
      let title = '';
      const titlePatterns = [
        /class="result__a"[^>]*>([^<]+)</i,
        /class="result__title"[^>]*>.*?<a[^>]*>([^<]+)</is,
        /<a[^>]*class="result__a"[^>]*>([^<]+)</i,
      ];
      
      for (const pattern of titlePatterns) {
        const match = divContent.match(pattern);
        if (match && match[1]) {
          title = cleanText(match[1]);
          if (title.length >= 5) break;
        }
      }
      
      if (title.length < 5) continue;
      
      // Extract snippet - try multiple patterns
      let snippet = '';
      const snippetPatterns = [
        /class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*)*)/i,
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
        /class="result-snippet"[^>]*>([^<]+)/i,
      ];
      
      for (const pattern of snippetPatterns) {
        const match = divContent.match(pattern);
        if (match && match[1]) {
          snippet = cleanText(match[1]);
          if (snippet.length >= 10) break;
        }
      }
      
      // Limit snippet length
      if (snippet.length > 200) {
        snippet = snippet.substring(0, 197) + '...';
      }
      
      // Try to extract thumbnail
      const thumbnail = extractThumbnail(divContent);
      
      results.push({
        title,
        url,
        snippet,
        thumbnail,
      });
      
      console.log('[web-search] Parsed:', { 
        title: title.substring(0, 40), 
        url: url.substring(0, 50),
        snippetLen: snippet.length,
        hasThumb: !!thumbnail,
      });
    }
    
    // Fallback parsing if no results
    if (results.length === 0) {
      console.log('[web-search] Trying fallback parsing...');
      
      const linkRegex = /href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([^<]{10,100})</gi;
      let match;
      
      while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
        try {
          let url = decodeURIComponent(match[1]);
          if (url.includes('%')) url = decodeURIComponent(url);
          const title = cleanText(match[2]);
          
          if (url.startsWith('http') && !url.includes('duckduckgo') && !seenUrls.has(url)) {
            seenUrls.add(url);
            results.push({ title, url, snippet: '' });
          }
        } catch {
          // Skip invalid entries
        }
      }
    }
    
    console.log('[web-search] Total results:', results.length);
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Query is required' } as SearchResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      return new Response(
        JSON.stringify({ success: false, error: 'Query too short' } as SearchResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log('[web-search] Processing query:', cleanQuery);

    let results: SearchResult[] = [];
    let error: string | undefined;
    
    try {
      results = await searchDuckDuckGo(cleanQuery);
    } catch (err) {
      console.error('[web-search] Search failed:', err);
      error = err instanceof Error && err.name === 'AbortError' 
        ? 'Search timed out. Please try again.'
        : 'Search failed. Please try again.';
    }
    
    if (results.length === 0 && !error) {
      console.log('[web-search] No results found for:', cleanQuery);
    }
    
    console.log('[web-search] Returning', results.length, 'results');
    
    return new Response(
      JSON.stringify({ 
        success: !error && results.length > 0, 
        results, 
        query: cleanQuery,
        error: error || (results.length === 0 ? 'No results found for your query.' : undefined)
      } as SearchResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[web-search] Error:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: 'Search failed. Please try again.' } as SearchResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
