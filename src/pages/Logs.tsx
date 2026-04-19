import { useState, useEffect } from "react";
import { FileText, AlertTriangle, CheckCircle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDeviceId } from "@/hooks/useDeviceId";

interface LogEntry {
  id: string;
  created_at: string;
  content_type: string;
  url: string | null;
  classification: string;
  action_taken: string;
  confidence: number | null;
}

const Logs = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const deviceId = useDeviceId();

  useEffect(() => {
    if (deviceId) {
      loadLogs();
    }
  }, [deviceId]);

  const loadLogs = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('content_moderation_logs')
      .select('*')
      .eq('device_id', deviceId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error loading logs:', error);
    } else {
      setLogs(data || []);
    }
    setIsLoading(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'blocked':
        return <XCircle className="w-4 h-4 text-destructive" />;
      case 'allowed':
        return <CheckCircle className="w-4 h-4 text-aqua" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-gold" />;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'blocked':
        return 'text-destructive';
      case 'allowed':
        return 'text-aqua';
      default:
        return 'text-gold';
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-aqua" />
            <div>
              <h1 className="font-display text-2xl tracking-wider">ACTIVITY LOG</h1>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">
                Protection Events
              </p>
            </div>
          </div>
          <button
            onClick={loadLogs}
            disabled={isLoading}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-aqua" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 mx-auto mb-4 text-silver/30" />
            <p className="text-muted-foreground">No activity logged yet</p>
            <p className="text-xs text-silver mt-2">
              Browse with Focus Browser to see logs here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="cathedral-card border-l-4"
                style={{
                  borderLeftColor: log.action_taken === 'blocked' 
                    ? 'hsl(var(--destructive))' 
                    : 'hsl(var(--aqua))',
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {getActionIcon(log.action_taken)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-display text-xs tracking-wider ${getActionColor(log.action_taken)}`}>
                        {log.action_taken.toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        • {log.content_type}
                      </span>
                    </div>
                    {log.url && (
                      <p className="text-sm text-foreground truncate mb-1">
                        {log.url}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDate(log.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Logs;
