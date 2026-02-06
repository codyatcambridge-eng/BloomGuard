import { useState } from "react";
import { Search, Youtube, FileText, Newspaper, Cloud, MapPin, BookOpen, ShoppingBag, Mail } from "lucide-react";
import { CathedralCard } from "@/components/ui/CathedralCard";
import { QuickLink } from "@/components/ui/QuickLink";
import { NativeWebViewBrowser } from "@/components/browser/NativeWebViewBrowser";
import { useNativeWebView } from "@/hooks/useNativeWebView";

const SafeBrowser = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const { isNative } = useNativeWebView();

  // Quick links that are generic and safe
  const quickLinks = [
    { icon: Youtube, label: "YouTube", url: "https://youtube.com", color: "text-flame" },
    { icon: FileText, label: "Articles", url: "https://medium.com", color: "text-gold" },
    { icon: Newspaper, label: "News", url: "https://news.google.com", color: "text-tech-blue" },
    { icon: Cloud, label: "Weather", url: "https://weather.com", color: "text-gold" },
    { icon: MapPin, label: "Maps", url: "https://maps.google.com", color: "text-flame" },
    { icon: BookOpen, label: "Learning", url: "https://khanacademy.org", color: "text-tech-blue" },
    { icon: ShoppingBag, label: "Shopping", url: "https://amazon.com", color: "text-gold" },
    { icon: Mail, label: "Mail", url: "https://gmail.com", color: "text-tech-blue" },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      // Check if it's a URL or search query
      const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/;
      if (urlPattern.test(searchQuery.trim())) {
        const url = searchQuery.startsWith('http') ? searchQuery : `https://${searchQuery}`;
        setActiveUrl(url);
      } else {
        setActiveUrl(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`);
      }
    }
  };

  const handleQuickLink = (url: string) => {
    setActiveUrl(url);
  };

  // If we have an active URL and native webview is available, show the browser
  if (activeUrl && isNative) {
    return <NativeWebViewBrowser />;
  }

  // Homepage view
  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Golden beam accent */}
      <div className="golden-beam" />
      
      {/* Atmospheric overlay - calmer for browser */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-b from-gold/3 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex flex-col items-center justify-center min-h-[70vh] px-6 pt-16">
        {/* Brand Title */}
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl text-gold tracking-wider mb-2 italic">
            GoodCreation.bet
          </h1>
          <div className="flex items-center justify-center gap-3">
            <span className="text-gold/40">◆</span>
            <p className="text-silver text-sm tracking-widest">Safe Surfing</p>
            <span className="text-gold/40">◆</span>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="w-full max-w-lg mb-10">
          <CathedralCard className="p-0 overflow-hidden">
            <div className="flex items-center">
              <div className="pl-4">
                <Search className="w-5 h-5 text-silver" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search the web safely..."
                className="flex-1 bg-transparent px-4 py-4 text-foreground placeholder:text-silver/50 focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={isSearching}
                className="px-6 py-4 bg-cathedral-steel/50 text-silver font-display text-sm tracking-wider hover:bg-cathedral-steel/70 transition-colors border-l border-gold/20"
              >
                Search
              </button>
            </div>
          </CathedralCard>
        </form>

        {/* Quick Links Grid */}
        <div className="w-full max-w-lg">
          <div className="grid grid-cols-4 gap-3">
            {quickLinks.map((link) => (
              <QuickLink
                key={link.label}
                icon={link.icon}
                label={link.label}
                iconColor={link.color}
                onClick={() => handleQuickLink(link.url)}
              />
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-24 left-0 right-0 px-6 text-center">
        <p className="text-[10px] text-silver/40 font-display tracking-widest">
          GOODCREATION SAFE BROWSER
        </p>
      </footer>
    </div>
  );
};

export default SafeBrowser;
