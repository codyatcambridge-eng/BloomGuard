/**
 * Admin Labels Viewer
 * 
 * Simple admin page to view the last 100 moderation labels for the signed-in user.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, AlertCircle, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ModerationLabel {
  id: string;
  request_id: string;
  item_id: string;
  src: string;
  page_url: string | null;
  platform: string | null;
  user_label: 'shirtless' | 'swimwear' | 'other' | 'unsure';
  consent_upload: boolean;
  created_at: string;
  model_prediction: { category?: string; confidence?: number } | null;
  status: string;
  attempts: number;
}

interface LabelStats {
  shirtless: number;
  swimwear: number;
  other: number;
  unsure: number;
  total: number;
}

const LABEL_COLORS: Record<string, string> = {
  shirtless: 'bg-orange-500',
  swimwear: 'bg-blue-500',
  other: 'bg-green-500',
  unsure: 'bg-gray-500',
};

export default function AdminLabels() {
  const navigate = useNavigate();
  const [labels, setLabels] = useState<ModerationLabel[]>([]);
  const [stats, setStats] = useState<LabelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLabels = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      if (!sessionData.session?.access_token) {
        throw new Error('Sign in required');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/moderation-labels?limit=100`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.ok) {
        setLabels(data.labels || []);
        setStats(data.stats || null);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (e) {
      console.error('[AdminLabels] Fetch error:', e);
      setError(e instanceof Error ? e.message : 'Failed to fetch labels');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount for signed-in users
  useEffect(() => {
    fetchLabels();
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const truncate = (str: string, len = 40) => {
    if (!str) return '-';
    return str.length > len ? str.slice(0, len) + '...' : str;
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold">Admin: Moderation Labels</h1>
        </div>

        <div className="flex gap-2 mb-6">
          <Button onClick={fetchLabels} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading...' : 'Refresh Labels'}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-4 mb-6 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm text-muted-foreground">Total</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </div>
            <div className="p-4 bg-orange-500/10 rounded-lg">
              <div className="text-sm text-orange-500">Shirtless</div>
              <div className="text-2xl font-bold text-orange-500">{stats.shirtless}</div>
            </div>
            <div className="p-4 bg-blue-500/10 rounded-lg">
              <div className="text-sm text-blue-500">Swimwear</div>
              <div className="text-2xl font-bold text-blue-500">{stats.swimwear}</div>
            </div>
            <div className="p-4 bg-green-500/10 rounded-lg">
              <div className="text-sm text-green-500">Other</div>
              <div className="text-2xl font-bold text-green-500">{stats.other}</div>
            </div>
            <div className="p-4 bg-gray-500/10 rounded-lg">
              <div className="text-sm text-gray-500">Unsure</div>
              <div className="text-2xl font-bold text-gray-500">{stats.unsure}</div>
            </div>
          </div>
        )}

        {/* Labels Table */}
        {labels.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Item ID</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Consent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {labels.map((label) => (
                  <TableRow key={label.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDate(label.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${LABEL_COLORS[label.user_label]} text-white`}>
                        {label.user_label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {label.platform || '-'}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {truncate(label.item_id, 20)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <a
                        href={label.src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        {truncate(label.src, 30)}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs">
                      {label.model_prediction?.category || '-'}
                      {label.model_prediction?.confidence != null && (
                        <span className="text-muted-foreground ml-1">
                          ({(label.model_prediction.confidence * 100).toFixed(0)}%)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {label.consent_upload ? (
                        <Badge variant="outline" className="text-green-500 border-green-500">
                          Yes
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          No
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : !loading && !error ? (
          <div className="text-center text-muted-foreground py-12">
            No labels found for this account.
          </div>
        ) : null}
      </div>
    </div>
  );
}
