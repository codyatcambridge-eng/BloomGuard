/**
 * Trigger Blocklist Panel
 * 
 * Allows users to configure which content categories trigger automatic blocking.
 * Organized into 10 groups with individual checklist items.
 */

import { useState } from 'react';
import { Shield, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useTriggerSettings } from '@/hooks/useTriggerSettings';
import { TRIGGER_GROUPS, MVP_BLOCKING_CATEGORIES } from '@/lib/trigger-categories';
import { useLocalSettings } from '@/hooks/useLocalSettings';

interface TriggerBlocklistPanelProps {
  compact?: boolean;
}

export const TriggerBlocklistPanel = ({ compact = false }: TriggerBlocklistPanelProps) => {
  const { triggers, toggleTrigger, toggleGroup, getGroupState, resetToDefaults } = useTriggerSettings();
  const { settings } = useLocalSettings();
  const [openGroups, setOpenGroups] = useState<string[]>(['shirtless', 'swimwear']);

  const toggleGroupOpen = (groupId: string) => {
    setOpenGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const enabledCount = Object.values(triggers).filter(Boolean).length;
  const totalCount = Object.keys(triggers).length;

  if (compact) {
    return (
      <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <Shield className="w-4 h-4 text-aqua" />
        <span className="text-sm font-medium">
          Trigger Blocklist: <span className="text-aqua">{enabledCount}/{totalCount}</span> active
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-aqua" />
          <h3 className="font-display text-lg tracking-wider">TRIGGER BLOCKLIST</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {enabledCount} active
          </Badge>
          <Button variant="ghost" size="sm" onClick={resetToDefaults}>
            Reset
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Select which content types should be automatically blocked. 
        <span className="text-aqua font-medium"> MVP focuses on shirtless and swimwear.</span>
      </p>

      {settings.blur_dial === 0 && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-4">
          <p className="text-xs text-yellow-500">
            ⚠️ AI Filter Intensity is OFF. Enable it in settings for triggers to work.
          </p>
        </div>
      )}

      <TooltipProvider>
        <div className="space-y-2">
          {TRIGGER_GROUPS.map(group => {
            const isOpen = openGroups.includes(group.id);
            const groupState = getGroupState(group.id);
            const isMVP = MVP_BLOCKING_CATEGORIES.includes(group.id as any);
            const activeInGroup = group.items.filter(item => triggers[item.id]).length;

            return (
              <Collapsible
                key={group.id}
                open={isOpen}
                onOpenChange={() => toggleGroupOpen(group.id)}
              >
                <div className={`rounded-lg border ${isMVP ? 'border-aqua/30 bg-aqua/5' : 'border-border'}`}>
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 rounded-t-lg">
                      <div className="flex items-center gap-3">
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="text-lg">{group.icon}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{group.name}</span>
                            {isMVP && (
                              <Badge variant="default" className="text-[10px] px-1 py-0 bg-aqua text-black">
                                MVP
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{group.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {activeInGroup}/{group.items.length}
                        </span>
                        <Switch
                          checked={groupState === 'all' || groupState === 'some'}
                          onCheckedChange={() => toggleGroup(group.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t border-border/50 p-3 space-y-2">
                      {group.items.map(item => {
                        const isEnabled = triggers[item.id] ?? item.defaultEnabled;
                        const meetsMinSensitivity = settings.blur_dial >= item.minSensitivity;

                        return (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between py-2 px-3 rounded ${
                              !meetsMinSensitivity ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <Label className="text-sm">{item.label}</Label>
                                  {!meetsMinSensitivity && (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Info className="w-3 h-3 text-yellow-500" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">
                                          Requires filter intensity level {item.minSensitivity}+
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{item.description}</p>
                              </div>
                            </div>
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={() => toggleTrigger(item.id)}
                              disabled={!meetsMinSensitivity}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </TooltipProvider>

      <div className="pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Triggers work with the AI filter intensity dial. Higher filter intensity = more triggers active.
        </p>
      </div>
    </div>
  );
};
