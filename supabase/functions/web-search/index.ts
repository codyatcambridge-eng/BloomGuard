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

// Clean HTML entities and tags
function cleanText(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  
  // DuckDuckGo HTML structure: each result is in a div with class containing "result"
  // The structure is:
  // <div class="result results_links results_links_deep web-result">
  //   <a class="result__a" href="...uddg=ENCODED_URL...">TITLE</a>
  //   <a class="result__snippet">SNIPPET</a>
  // </div>
  
  // Split by result containers
  const resultDivs = html.split(/class="result\s+results_links/i);
  console.log('[web-search] Found result divs:', resultDivs.length - 1);
  
  for (let i = 1; i < resultDivs.length && results.length < 10; i++) {
    const div = resultDivs[i];
    
    // Find the end of this result div (next major section)
    const divContent = div.substring(0, 3000); // Limit to avoid overflow
    
    // Extract URL (uddg parameter contains the actual URL)
    const uddgMatch = divContent.match(/uddg=([^&"']+)/);
    if (!uddgMatch) continue;
    
    let url: string;
    try {
      url = decodeURIComponent(uddgMatch[1]);
    } catch {
      continue;
    }
    
    // Skip non-http URLs and duplicates
    if (!url.startsWith('http') || url.includes('duckduckgo') || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    
    // Extract title (text inside result__a link)
    const titleMatch = divContent.match(/class="result__a"[^>]*>([^<]+)</i);
    if (!titleMatch) continue;
    
    const title = cleanText(titleMatch[1]);
    if (title.length < 5) continue;
    
    // Extract snippet (text inside result__snippet)
    let snippet = '';
    const snippetMatch = divContent.match(/class="result__snippet"[^>]*>([^<]+)/i);
    if (snippetMatch) {
      snippet = cleanText(snippetMatch[1]);
    }
    
    // Limit snippet length
    if (snippet.length > 200) {
      snippet = snippet.substring(0, 200) + '...';
    }
    
    results.push({
      title,
      url,
      snippet,
    });
    
    console.log('[web-search] Parsed:', { 
      title: title.substring(0, 40), 
      url: url.substring(0, 50),
      snippetLen: snippet.length 
    });
  }
  
  // Fallback: try alternative parsing if no results
  if (results.length === 0) {
    console.log('[web-search] Trying fallback parsing...');
    
    // Look for any uddg links with reasonable text
    const linkRegex = /href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([^<]{10,100})</gi;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
      try {
        const url = decodeURIComponent(match[1]);
        const title = cleanText(match[2]);
        
        if (url.startsWith('http') && !url.includes('duckduckgo') && !seenUrls.has(url)) {
          seenUrls.add(url);
          results.push({ title, url, snippet: '' });
        }
      } catch {
        // Skip invalid
      }
    }
  }
  
  console.log('[web-search] Total results:', results.length);
  return results;
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
      error = 'Search failed. Please try again.';
    }
    
    // If no results and no error, set appropriate message
    if (results.length === 0 && !error) {
      console.log('[web-search] No results found for:', cleanQuery);
    }
    
    console.log('[web-search] Returning', results.length, 'results');
    
    return new Response(
      JSON.stringify({ 
        success: !error, 
        results, 
        query: cleanQuery,
        error: error || (results.length === 0 ? 'No results found.' : undefined)
      } as SearchResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[web-search] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: 'Search failed. Try again.' } as SearchResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
