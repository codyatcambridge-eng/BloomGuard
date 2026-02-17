import { useState, useEffect, useCallback } from 'react';
import { ADULT_DOMAIN_BLOCKLIST_SNAPSHOT } from '@/lib/domain-blocklist';

export interface BlockedDomain {
  id: string;
  domain: string;
  category: string;
  addedAt: string;
  isBuiltIn: boolean;
}

const BLOCKLIST_KEY = 'iron_watch_local_blocklist';

const BUILT_IN_BLOCKLIST: Omit<BlockedDomain, 'id' | 'addedAt'>[] = ADULT_DOMAIN_BLOCKLIST_SNAPSHOT.map((domain) => ({
  domain,
  category: 'adult',
  isBuiltIn: true,
}));

const generateId = () => crypto.randomUUID();

const normalizeHost = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase().replace(/\.+$/, '').replace(/^(www\.|m\.)/, '');
  } catch {
    return trimmed.toLowerCase().replace(/\.+$/, '').replace(/^(https?:\/\/)?(www\.|m\.)/, '').split('/')[0];
  }
};

export const useLocalBlocklist = () => {
  const [customDomains, setCustomDomains] = useState<BlockedDomain[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load custom blocklist from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(BLOCKLIST_KEY);
      if (stored) {
        setCustomDomains(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load local blocklist:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save custom domains to localStorage
  const saveCustomDomains = useCallback((domains: BlockedDomain[]) => {
    try {
      localStorage.setItem(BLOCKLIST_KEY, JSON.stringify(domains));
      setCustomDomains(domains);
    } catch (error) {
      console.error('Failed to save local blocklist:', error);
    }
  }, []);

  // Get full blocklist (built-in + custom)
  const getAllDomains = useCallback((): BlockedDomain[] => {
    const builtIn = BUILT_IN_BLOCKLIST.map((d, i) => ({
      ...d,
      id: `builtin-${i}`,
      addedAt: '2024-01-01T00:00:00Z',
    }));
    return [...builtIn, ...customDomains];
  }, [customDomains]);

  // Add a domain to custom blocklist
  const addDomain = useCallback((domain: string, category: string = 'custom') => {
    // Normalize domain
    const normalized = normalizeHost(domain);
    if (!normalized) return false;
    
    // Check if already exists
    const allDomains = getAllDomains();
    if (allDomains.some(d => d.domain === normalized)) {
      return false;
    }

    const newDomain: BlockedDomain = {
      id: generateId(),
      domain: normalized,
      category,
      addedAt: new Date().toISOString(),
      isBuiltIn: false,
    };

    saveCustomDomains([...customDomains, newDomain]);
    return true;
  }, [customDomains, getAllDomains, saveCustomDomains]);

  // Remove a domain from custom blocklist
  const removeDomain = useCallback((id: string) => {
    const domain = customDomains.find(d => d.id === id);
    if (!domain || domain.isBuiltIn) {
      return false;
    }
    saveCustomDomains(customDomains.filter(d => d.id !== id));
    return true;
  }, [customDomains, saveCustomDomains]);

  // Check if a URL is blocked
  const isBlocked = useCallback((url: string): { blocked: boolean; domain?: string; category?: string } => {
    try {
      const hostname = normalizeHost(url);
      if (!hostname) return { blocked: false };
      
      const allDomains = getAllDomains();
      for (const blocked of allDomains) {
        // Check exact match or subdomain match
        if (hostname === blocked.domain || hostname.endsWith(`.${blocked.domain}`)) {
          return { blocked: true, domain: blocked.domain, category: blocked.category };
        }
      }
      return { blocked: false };
    } catch {
      return { blocked: false };
    }
  }, [getAllDomains]);

  // Export blocklist as JSON
  const exportBlocklist = useCallback(() => {
    return JSON.stringify(customDomains, null, 2);
  }, [customDomains]);

  // Import blocklist from JSON
  const importBlocklist = useCallback((json: string) => {
    try {
      const imported = JSON.parse(json) as BlockedDomain[];
      const validated = imported.filter(d => 
        typeof d.domain === 'string' && 
        typeof d.category === 'string'
      ).map(d => ({
        ...d,
        id: generateId(),
        isBuiltIn: false,
        addedAt: d.addedAt || new Date().toISOString(),
      }));
      saveCustomDomains([...customDomains, ...validated]);
      return true;
    } catch {
      return false;
    }
  }, [customDomains, saveCustomDomains]);

  return {
    domains: getAllDomains(),
    customDomains,
    isLoaded,
    addDomain,
    removeDomain,
    isBlocked,
    exportBlocklist,
    importBlocklist,
  };
};
