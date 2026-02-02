import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// Parse DuckDuckGo HTML search results
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  console.log('[web-search] Searching DuckDuckGo for:', query);
  
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    console.error('[web-search] DuckDuckGo request failed:', response.status);
    throw new Error(`Search request failed: ${response.status}`);
  }

  const html = await response.text();
  console.log('[web-search] Received HTML length:', html.length);

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();
  
  // Primary parsing: Look for result__a links with uddg parameter
  const resultLinkRegex = /href="[^"]*uddg=([^&"]+)[^"]*"[^>]*class="result__a"[^>]*>([^<]+)</gi;
  const resultLinkRegex2 = /class="result__a"[^>]*href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([^<]+)</gi;
  
  let match;
  
  // Try first pattern
  while ((match = resultLinkRegex.exec(html)) !== null && results.length < 15) {
    try {
      const url = decodeURIComponent(match[1]);
      const title = match[2].trim();
      
      if (url.startsWith('http') && title.length > 10 && !url.includes('duckduckgo') && !seenUrls.has(url)) {
        seenUrls.add(url);
        results.push({ title, url, snippet: '' });
        console.log('[web-search] Found result:', title.substring(0, 40));
      }
    } catch (e) {
      // Skip invalid URLs
    }
  }
  
  // Try second pattern if first didn't work
  if (results.length === 0) {
    while ((match = resultLinkRegex2.exec(html)) !== null && results.length < 15) {
      try {
        const url = decodeURIComponent(match[1]);
        const title = match[2].trim();
        
        if (url.startsWith('http') && title.length > 10 && !url.includes('duckduckgo') && !seenUrls.has(url)) {
          seenUrls.add(url);
          results.push({ title, url, snippet: '' });
        }
      } catch (e) {
        // Skip invalid URLs
      }
    }
  }
  
  // Fallback: Find any external links with uddg
  if (results.length === 0) {
    console.log('[web-search] Trying uddg fallback...');
    const uddgRegex = /href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([^<]+)</gi;
    
    while ((match = uddgRegex.exec(html)) !== null && results.length < 15) {
      try {
        const url = decodeURIComponent(match[1]);
        const title = match[2].trim();
        
        // Filter out low-quality matches
        if (url.startsWith('http') && 
            title.length > 15 && 
            !url.includes('duckduckgo') &&
            !seenUrls.has(url) &&
            !title.toLowerCase().includes('duckduckgo') &&
            !/^[a-z]+\.[a-z]+/.test(title.toLowerCase())) {
          seenUrls.add(url);
          results.push({ title, url, snippet: '' });
        }
      } catch (e) {
        // Skip invalid
      }
    }
  }
  
  // Extract snippets for found URLs
  for (const result of results) {
    // Find snippet near this URL in the HTML
    const urlEscaped = result.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const snippetRegex = new RegExp(`${urlEscaped.substring(0, 50)}[^<]*<[^>]*>([^<]{20,200})`, 'i');
    const snippetMatch = html.match(snippetRegex);
    if (snippetMatch) {
      result.snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
    }
  }
  
  // Try to find snippets from result__snippet class
  const snippetBlocks = html.match(/class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)/gi) || [];
  for (let i = 0; i < Math.min(snippetBlocks.length, results.length); i++) {
    if (!results[i].snippet && snippetBlocks[i]) {
      const snippetText = snippetBlocks[i].replace(/class="result__snippet"[^>]*>/i, '').replace(/<[^>]+>/g, '').trim();
      if (snippetText.length > 20) {
        results[i].snippet = snippetText;
      }
    }
  }
  
  console.log('[web-search] Total results:', results.length);
  return results.slice(0, 10); // Return max 10 results
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
    
    try {
      results = await searchDuckDuckGo(cleanQuery);
    } catch (error) {
      console.error('[web-search] Search failed:', error);
    }
    
    console.log('[web-search] Returning', results.length, 'results');
    
    return new Response(
      JSON.stringify({ success: true, results, query: cleanQuery } as SearchResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[web-search] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage } as SearchResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
