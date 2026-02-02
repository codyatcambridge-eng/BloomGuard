import { useState } from "react";
import { Search, Shield, Sparkles } from "lucide-react";

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
    // Random safe search queries for fun
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

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 bg-background min-h-[60vh]">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-3 mb-2">
          <Shield className="w-12 h-12 text-aqua" />
          <h1 className="font-display text-4xl tracking-wider text-foreground">
            IRON WATCH
          </h1>
        </div>
        <p className="text-sm text-muted-foreground font-display tracking-wide">
          PROTECTED SEARCH
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSubmit} className="w-full max-w-xl mb-6">
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-aqua/20 via-transparent to-aqua/20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative flex items-center bg-card border border-silver/30 rounded-full shadow-lg hover:shadow-xl hover:border-silver/50 transition-all duration-300">
            <Search className="w-5 h-5 text-muted-foreground ml-5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the web safely..."
              className="flex-1 bg-transparent px-4 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none text-base"
              disabled={isSearching}
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="p-2 mr-2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Action Buttons */}
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={handleSubmit}
          disabled={!query.trim() || isSearching}
          className="px-6 py-2.5 bg-muted hover:bg-muted/80 text-foreground text-sm font-display tracking-wide rounded-sm border border-silver/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSearching ? "SEARCHING..." : "SEARCH"}
        </button>
        <button
          onClick={handleFeelingProtected}
          disabled={isSearching}
          className="px-6 py-2.5 bg-muted hover:bg-muted/80 text-foreground text-sm font-display tracking-wide rounded-sm border border-silver/20 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4 text-aqua" />
          I'M FEELING PROTECTED
        </button>
      </div>

      {/* Footer Info */}
      <div className="mt-12 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-aqua/10 border border-aqua/30 rounded-full">
          <Shield className="w-4 h-4 text-aqua" />
          <span className="text-xs font-display text-aqua tracking-wide">
            ALL IMAGES MODERATED ON-DEVICE
          </span>
        </div>
        <p className="mt-4 text-xs text-muted-foreground max-w-md">
          Search results are filtered for your protection. Images are scanned locally using AI before display.
        </p>
      </div>
    </div>
  );
};
