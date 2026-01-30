import { useState, useEffect } from "react";
import { Shield, Image, Globe, AlertTriangle, CheckCircle, XCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { useContentProtection, Sensitivity, ModerationResult, BlockCheckResult } from "@/hooks/useContentProtection";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BlockedSite {
  id: string;
  domain: string;
  category: string;
  is_active: boolean;
}

const ContentGuard = () => {
  const { moderateImage, checkBlockedSite, isChecking, error } = useContentProtection();
  const [activeTab, setActiveTab] = useState<'image' | 'website'>('image');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('strict');
  const [imageUrl, setImageUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [imageResult, setImageResult] = useState<ModerationResult | null>(null);
  const [siteResult, setSiteResult] = useState<BlockCheckResult | null>(null);
  const [blockedSites, setBlockedSites] = useState<BlockedSite[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [isLoadingSites, setIsLoadingSites] = useState(true);

  useEffect(() => {
    loadBlockedSites();
  }, []);

  const loadBlockedSites = async () => {
    setIsLoadingSites(true);
    const { data, error } = await supabase
      .from('blocked_sites')
      .select('*')
      .order('domain');
    
    if (error) {
      toast.error('Failed to load blocked sites');
      console.error(error);
    } else {
      setBlockedSites(data || []);
    }
    setIsLoadingSites(false);
  };

  const handleImageCheck = async () => {
    if (!imageUrl.trim()) {
      toast.error('Please enter an image URL');
      return;
    }
    setImageResult(null);
    const result = await moderateImage(imageUrl, sensitivity);
    setImageResult(result);
  };

  const handleSiteCheck = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter a website URL');
      return;
    }
    setSiteResult(null);
    const result = await checkBlockedSite(websiteUrl);
    setSiteResult(result);
  };

  const handleAddSite = async () => {
    if (!newDomain.trim()) {
      toast.error('Please enter a domain');
      return;
    }
    
    const cleanDomain = newDomain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    
    const { error } = await supabase
      .from('blocked_sites')
      .insert({ domain: cleanDomain, category: 'custom' });
    
    if (error) {
      if (error.code === '23505') {
        toast.error('This domain is already blocked');
      } else {
        toast.error('Failed to add domain');
      }
    } else {
      toast.success('Domain added to blocklist');
      setNewDomain('');
      loadBlockedSites();
    }
  };

  const handleRemoveSite = async (id: string) => {
    const { error } = await supabase
      .from('blocked_sites')
      .delete()
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to remove domain');
    } else {
      toast.success('Domain removed from blocklist');
      loadBlockedSites();
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-aqua" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">CONTENT GUARD</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              AI-Powered Content Protection
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        {/* Tab Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('image')}
            className={`flex-1 py-3 px-4 font-display text-sm tracking-wider transition-all flex items-center justify-center gap-2 ${
              activeTab === 'image'
                ? 'bg-aqua text-accent-foreground'
                : 'border border-silver/30 text-silver hover:border-silver/60'
            }`}
          >
            <Image className="w-4 h-4" />
            IMAGE FILTER
          </button>
          <button
            onClick={() => setActiveTab('website')}
            className={`flex-1 py-3 px-4 font-display text-sm tracking-wider transition-all flex items-center justify-center gap-2 ${
              activeTab === 'website'
                ? 'bg-aqua text-accent-foreground'
                : 'border border-silver/30 text-silver hover:border-silver/60'
            }`}
          >
            <Globe className="w-4 h-4" />
            SITE BLOCKER
          </button>
        </div>

        {/* Image Moderation Tab */}
        {activeTab === 'image' && (
          <div className="space-y-4">
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                BLUR SENSITIVITY
              </h3>
              <div className="flex gap-2">
                {(['strict', 'moderate', 'relaxed'] as Sensitivity[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => setSensitivity(level)}
                    className={`flex-1 py-2 text-xs font-display tracking-wider transition-all ${
                      sensitivity === level
                        ? 'bg-aqua text-accent-foreground'
                        : 'border border-silver/30 text-silver hover:border-silver/60'
                    }`}
                  >
                    {level.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {sensitivity === 'strict' && 'Blurs shirtless, swimwear, and suggestive content'}
                {sensitivity === 'moderate' && 'Blurs explicit and sexually suggestive content only'}
                {sensitivity === 'relaxed' && 'Only blurs explicit nudity and pornography'}
              </p>
            </section>

            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                TEST IMAGE MODERATION
              </h3>
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="Enter image URL to test..."
                className="w-full bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
              />
              <button
                onClick={handleImageCheck}
                disabled={isChecking}
                className="w-full mt-3 py-3 font-display text-sm tracking-wider bg-aqua text-accent-foreground hover:bg-aqua/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    ANALYZING...
                  </>
                ) : (
                  'ANALYZE IMAGE'
                )}
              </button>
            </section>

            {imageResult && (
              <section 
                className={`cathedral-card border-l-4 ${
                  imageResult.shouldBlur ? 'border-l-destructive' : 'border-l-aqua'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  {imageResult.shouldBlur ? (
                    <XCircle className="w-6 h-6 text-destructive" />
                  ) : (
                    <CheckCircle className="w-6 h-6 text-aqua" />
                  )}
                  <h3 className="font-display text-lg tracking-wider">
                    {imageResult.shouldBlur ? 'CONTENT FLAGGED' : 'CONTENT SAFE'}
                  </h3>
                </div>
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Classification:</span> <span className="text-foreground">{imageResult.classification}</span></p>
                  <p><span className="text-muted-foreground">Confidence:</span> <span className="text-foreground">{(imageResult.confidence * 100).toFixed(0)}%</span></p>
                  <p><span className="text-muted-foreground">Categories:</span> <span className="text-foreground">{imageResult.categories.join(', ') || 'None'}</span></p>
                  <p><span className="text-muted-foreground">Reason:</span> <span className="text-foreground">{imageResult.reason}</span></p>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Website Blocking Tab */}
        {activeTab === 'website' && (
          <div className="space-y-4">
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                CHECK WEBSITE
              </h3>
              <input
                type="text"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="Enter website URL to check..."
                className="w-full bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
              />
              <button
                onClick={handleSiteCheck}
                disabled={isChecking}
                className="w-full mt-3 py-3 font-display text-sm tracking-wider bg-aqua text-accent-foreground hover:bg-aqua/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    CHECKING...
                  </>
                ) : (
                  'CHECK SITE'
                )}
              </button>
            </section>

            {siteResult && (
              <section 
                className={`cathedral-card border-l-4 ${
                  siteResult.isBlocked ? 'border-l-destructive' : 'border-l-aqua'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  {siteResult.isBlocked ? (
                    <AlertTriangle className="w-6 h-6 text-destructive" />
                  ) : (
                    <CheckCircle className="w-6 h-6 text-aqua" />
                  )}
                  <h3 className="font-display text-lg tracking-wider">
                    {siteResult.isBlocked ? 'SITE BLOCKED' : 'SITE ALLOWED'}
                  </h3>
                </div>
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Domain:</span> <span className="text-foreground">{siteResult.domain}</span></p>
                  {siteResult.category && (
                    <p><span className="text-muted-foreground">Category:</span> <span className="text-destructive">{siteResult.category}</span></p>
                  )}
                  <p><span className="text-muted-foreground">Status:</span> <span className="text-foreground">{siteResult.reason}</span></p>
                </div>
              </section>
            )}

            {/* Add New Blocked Site */}
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                ADD BLOCKED SITE
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                  className="flex-1 bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
                />
                <button
                  onClick={handleAddSite}
                  className="px-4 py-3 bg-gold text-cathedral-midnight font-display text-sm tracking-wider hover:bg-gold/90 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </section>

            {/* Blocked Sites List */}
            <section className="cathedral-card">
              <h3 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
                BLOCKLIST ({blockedSites.length} sites)
              </h3>
              {isLoadingSites ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-aqua" />
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {blockedSites.map((site) => (
                    <div 
                      key={site.id}
                      className="flex items-center justify-between py-2 px-3 bg-secondary/30 border border-silver/10"
                    >
                      <div>
                        <p className="text-sm text-foreground">{site.domain}</p>
                        <p className="text-xs text-muted-foreground">{site.category}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveSite(site.id)}
                        className="p-2 text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {error && (
          <div className="cathedral-card border-l-4 border-l-destructive">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ContentGuard;
