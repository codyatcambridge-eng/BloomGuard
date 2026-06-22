import { useState } from "react";
import { Search, Shield, Sparkles, Instagram, Youtube, Link } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SafeBrowserHomepageProps {
  onSearch: (query: string) => void;
  isSearching?: boolean;
}

export const SafeBrowserHomepage = ({ onSearch, isSearching = false }: SafeBrowserHomepageProps) => {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleFeelingProtected = () => {
    const safeQueries = [
      "beautiful nature photography",
      "inspiring quotes",
      "cute animals",
      "space exploration news",
      "healthy recipes",
      "productivity tips",
      "meditation techniques",
      "travel destinations",
    ];
    const randomQuery = safeQueries[Math.floor(Math.random() * safeQueries.length)];
    onSearch(randomQuery);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault();
      onSearch(query.trim());
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-[80vh] bg-background">
      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center gap-4 mb-3">
            <Shield className="w-16 h-16 text-aqua" />
          </div>
          <h1 className="font-display text-5xl tracking-wider text-foreground mb-2">
            Focus Browser
          </h1>
          <p className="mt-1 font-display tracking-widest text-aqua">
            FUN HOME MARKER 2026-05-29
          </p>
          <p className="mt-1 font-display tracking-widest text-aqua">try</p>
          <p className="italic" style={{ fontSize: '14px', color: '#E0E0E0' }}>
            Algorithms are noisy, real life is quiet where Focus Browser is.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">fun</p>
          <p className="mt-1 font-display tracking-wide text-aqua">BOY</p>
          <p className="mt-1 font-display tracking-wide text-aqua">Geese</p>
          <p className="mt-1 font-display tracking-wide text-aqua">DUck Duck</p>
          <p className="mt-1 font-display tracking-wide text-aqua">boyii</p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="w-full max-w-2xl mb-8">
          <div className="relative group">
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-aqua/20 via-transparent to-aqua/20 rounded-full blur-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-500" />
            
            {/* Search input container */}
            <div className="relative flex items-center bg-card border-2 border-border rounded-full shadow-lg hover:shadow-xl hover:border-silver/50 focus-within:border-aqua/50 transition-all duration-300">
              <Search className="w-5 h-5 text-muted-foreground ml-6 flex-shrink-0" />
              <Input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search the web safely…"
                className="flex-1 bg-transparent border-0 px-4 py-5 text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 text-base"
                disabled={isSearching}
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="p-2 mr-4 text-muted-foreground hover:text-foreground transition-colors text-xl"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Action Buttons */}
        <div className="flex gap-4 flex-wrap justify-center">
          <Button
            onClick={handleSubmit}
            disabled={!query.trim() || isSearching}
            variant="secondary"
            className="px-8 py-3 font-display tracking-wider text-sm hover:bg-muted/80 transition-all"
          >
            {isSearching ? "SEARCHING..." : "SEARCH"}
          </Button>
          <Button
            onClick={handleFeelingProtected}
            disabled={isSearching}
            variant="secondary"
            className="px-6 py-3 font-display tracking-wider text-sm hover:bg-muted/80 transition-all"
          >
            <Sparkles className="w-4 h-4 mr-2 text-aqua" />
            I'M FEELING PROTECTED
          </Button>
        </div>

        {/* Quick social launches */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
          <Button
            type="button"
            variant="secondary"
            className="justify-center gap-2"
            onClick={() => onSearch("https://www.snapchat.com")}
            disabled={isSearching}
          >
            <Link className="w-4 h-4" />
            Snapchat
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="justify-center gap-2"
            onClick={() => onSearch("https://www.instagram.com")}
            disabled={isSearching}
          >
            <Instagram className="w-4 h-4" />
            Instagram
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="justify-center gap-2"
            onClick={() => onSearch("https://www.youtube.com")}
            disabled={isSearching}
          >
            <Youtube className="w-4 h-4" />
            YouTube
          </Button>
        </div>

        {/* Protection Badge */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-aqua/10 border border-aqua/30 rounded-full">
            <Shield className="w-4 h-4 text-aqua" />
            <span className="text-xs font-display text-aqua tracking-wider">
              ALL IMAGES MODERATED ON-DEVICE
            </span>
          </div>
          <p className="mt-4 text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
            Search results are filtered for your protection. Images are scanned locally using AI before display.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 px-6">
        <div className="flex items-center justify-center gap-8 text-xs text-muted-foreground">
          <button 
            type="button"
            className="hover:text-foreground transition-colors font-display tracking-wide"
            onClick={() => {}}
          >
            About
          </button>
          <button 
            type="button"
            className="hover:text-foreground transition-colors font-display tracking-wide"
            onClick={() => {}}
          >
            Privacy
          </button>
          <button 
            type="button"
            className="hover:text-foreground transition-colors font-display tracking-wide"
            onClick={() => {}}
          >
            Terms
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/60 mt-3 font-display tracking-wider">
          FOCUS BROWSER © 2026
        </p>
      </footer>
    </div>
  );
};
