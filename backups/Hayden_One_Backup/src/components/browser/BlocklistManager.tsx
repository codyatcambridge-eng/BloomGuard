import { useState } from "react";
import { Shield, Trash2, Plus, Download, Upload, Search } from "lucide-react";
import { useLocalBlocklist, BlockedDomain } from "@/hooks/useLocalBlocklist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const CATEGORIES = [
  { value: 'adult', label: 'Adult Content' },
  { value: 'proxy', label: 'Proxy/VPN' },
  { value: 'social', label: 'Social Media' },
  { value: 'gambling', label: 'Gambling' },
  { value: 'custom', label: 'Custom' },
];

export const BlocklistManager = () => {
  const { domains, customDomains, addDomain, removeDomain, exportBlocklist, importBlocklist } = useLocalBlocklist();
  const [newDomain, setNewDomain] = useState("");
  const [newCategory, setNewCategory] = useState("custom");
  const [searchQuery, setSearchQuery] = useState("");
  const [showBuiltIn, setShowBuiltIn] = useState(false);

  const handleAddDomain = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;

    const success = addDomain(newDomain, newCategory);
    if (success) {
      toast.success(`Added ${newDomain} to blocklist`);
      setNewDomain("");
    } else {
      toast.error("Domain already exists in blocklist");
    }
  };

  const handleRemoveDomain = (id: string, domain: string) => {
    const success = removeDomain(id);
    if (success) {
      toast.success(`Removed ${domain} from blocklist`);
    }
  };

  const handleExport = () => {
    const data = exportBlocklist();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'iron-watch-blocklist.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Blocklist exported");
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const success = importBlocklist(reader.result as string);
      if (success) {
        toast.success("Blocklist imported successfully");
      } else {
        toast.error("Failed to import blocklist");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filteredDomains = domains.filter(d => {
    if (!showBuiltIn && d.isBuiltIn) return false;
    if (searchQuery && !d.domain.includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const displayedCustom = customDomains.filter(d => 
    !searchQuery || d.domain.includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-6 h-6 text-aqua" />
        <h2 className="font-display text-lg tracking-wider">BLOCKLIST MANAGER</h2>
      </div>

      {/* Add domain form */}
      <form onSubmit={handleAddDomain} className="space-y-3">
        <Label className="text-xs font-display tracking-wider text-muted-foreground">
          ADD NEW DOMAIN
        </Label>
        <div className="flex gap-2">
          <Input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="example.com"
            className="flex-1"
          />
          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="icon">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </form>

      {/* Import/Export */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
          <Button variant="outline" size="sm" asChild>
            <span>
              <Upload className="w-4 h-4 mr-2" />
              Import
            </span>
          </Button>
        </label>
      </div>

      {/* Search and filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search domains..."
            className="pl-10"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showBuiltIn}
            onChange={(e) => setShowBuiltIn(e.target.checked)}
            className="rounded border-silver/30"
          />
          <span className="text-muted-foreground">Show built-in domains ({domains.filter(d => d.isBuiltIn).length})</span>
        </label>
      </div>

      {/* Custom domains list */}
      <div className="space-y-2">
        <Label className="text-xs font-display tracking-wider text-muted-foreground">
          CUSTOM DOMAINS ({displayedCustom.length})
        </Label>
        {displayedCustom.length === 0 ? (
          <p className="text-sm text-silver py-4 text-center">
            No custom domains added yet
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {displayedCustom.map((domain) => (
              <div
                key={domain.id}
                className="flex items-center justify-between p-2 bg-input rounded border border-silver/20"
              >
                <div>
                  <div className="text-sm font-mono">{domain.domain}</div>
                  <div className="text-xs text-muted-foreground capitalize">{domain.category}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveDomain(domain.id, domain.domain)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Built-in domains list (if showing) */}
      {showBuiltIn && (
        <div className="space-y-2">
          <Label className="text-xs font-display tracking-wider text-muted-foreground">
            BUILT-IN DOMAINS ({filteredDomains.filter(d => d.isBuiltIn).length})
          </Label>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filteredDomains.filter(d => d.isBuiltIn).map((domain) => (
              <div
                key={domain.id}
                className="flex items-center justify-between p-2 bg-input/50 rounded border border-silver/10"
              >
                <div>
                  <div className="text-sm font-mono text-muted-foreground">{domain.domain}</div>
                  <div className="text-xs text-silver capitalize">{domain.category}</div>
                </div>
                <span className="text-xs text-silver">Built-in</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-silver/20">
        <p className="text-xs text-silver">
          Total blocked: {domains.length} domains
          <br />
          All blocking happens locally on your device.
        </p>
      </div>
    </div>
  );
};
