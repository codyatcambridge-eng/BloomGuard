import { useState } from "react";
import { FileText, Trash2, Download, Clock, Shield, AlertTriangle, Eye, Navigation } from "lucide-react";
import { useLocalLogs, LocalModerationLog } from "@/hooks/useLocalLogs";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";

const getLogIcon = (type: LocalModerationLog['type']) => {
  switch (type) {
    case 'navigation': return <Navigation className="w-4 h-4 text-blue-500" />;
    case 'block': return <AlertTriangle className="w-4 h-4 text-destructive" />;
    case 'blur': return <Eye className="w-4 h-4 text-yellow-500" />;
    case 'image_scan': return <Shield className="w-4 h-4 text-aqua" />;
    default: return <FileText className="w-4 h-4" />;
  }
};

const getLogColor = (type: LocalModerationLog['type']) => {
  switch (type) {
    case 'navigation': return 'border-blue-500/30 bg-blue-500/5';
    case 'block': return 'border-destructive/30 bg-destructive/5';
    case 'blur': return 'border-yellow-500/30 bg-yellow-500/5';
    case 'image_scan': return 'border-aqua/30 bg-aqua/5';
    default: return 'border-silver/20';
  }
};

export const LocalLogsPanel = () => {
  const { logs, clearLogs, exportLogs, getTodayStats } = useLocalLogs();
  const [filter, setFilter] = useState<LocalModerationLog['type'] | 'all'>('all');

  const stats = getTodayStats();

  const handleExport = () => {
    const data = exportLogs();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iron-watch-logs-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs exported");
  };

  const handleClear = () => {
    clearLogs();
    toast.success("Logs cleared");
  };

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.type === filter);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-aqua" />
          <h2 className="font-display text-lg tracking-wider">LOCAL LOGS</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      {/* Today's stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="p-2 bg-card border border-silver/20 rounded text-center">
          <div className="text-lg font-display text-aqua">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Today</div>
        </div>
        <div className="p-2 bg-card border border-silver/20 rounded text-center">
          <div className="text-lg font-display text-blue-500">{stats.navigations}</div>
          <div className="text-xs text-muted-foreground">Visits</div>
        </div>
        <div className="p-2 bg-card border border-silver/20 rounded text-center">
          <div className="text-lg font-display text-destructive">{stats.blocks}</div>
          <div className="text-xs text-muted-foreground">Blocks</div>
        </div>
        <div className="p-2 bg-card border border-silver/20 rounded text-center">
          <div className="text-lg font-display text-yellow-500">{stats.blurs}</div>
          <div className="text-xs text-muted-foreground">Blurs</div>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'navigation', 'block', 'blur', 'image_scan'] as const).map(type => (
          <Button
            key={type}
            variant={filter === type ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(type)}
            className="text-xs"
          >
            {type === 'all' ? 'All' : type.replace('_', ' ').toUpperCase()}
          </Button>
        ))}
      </div>

      {/* Logs list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-12 h-12 mx-auto mb-2 text-silver/30" />
            <p className="text-sm text-muted-foreground">No logs yet</p>
            <p className="text-xs text-silver">Start browsing to generate logs</p>
          </div>
        ) : (
          filteredLogs.map(log => (
            <div
              key={log.id}
              className={`p-3 rounded border ${getLogColor(log.type)}`}
            >
              <div className="flex items-start gap-2">
                {getLogIcon(log.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display uppercase text-muted-foreground">
                      {log.type.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-silver">
                      {format(new Date(log.timestamp), 'HH:mm:ss')}
                    </span>
                  </div>
                  {log.domain && (
                    <div className="text-sm font-mono truncate">{log.domain}</div>
                  )}
                  {log.url && !log.domain && (
                    <div className="text-sm font-mono truncate">{log.url}</div>
                  )}
                  {log.details && (
                    <div className="text-xs text-muted-foreground mt-1">{log.details}</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="pt-4 border-t border-silver/20">
        <p className="text-xs text-silver">
          {logs.length} logs stored locally (max 1000)
          <br />
          No data is sent to any server.
        </p>
      </div>
    </div>
  );
};
