/**
 * Share Card Preview Screen
 * Render-only preview of the share card with safe stats.
 * No share API implementation - just visual preview.
 */

import { ArrowLeft, Download, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ShareCard } from '@/components/share';
import { loadUserProgress } from '@/storage/userRepo';
import { UserProgress } from '@/models/UserProgress';
import { WeeklyChallengeType } from '@/logic/challengeEngine';

export default function ShareCardPreview() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<UserProgress | null>(null);
  
  useEffect(() => {
    const load = async () => {
      const userProgress = await loadUserProgress();
      setProgress(userProgress);
    };
    load();
  }, []);
  
  if (!progress) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-obsidian text-foreground">
      {/* Header */}
      <div className="bg-obsidian-light/50 border-b border-silver/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-silver hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-display text-lg text-foreground">Share Card</h1>
            <p className="text-xs text-muted-foreground">Preview your progress card</p>
          </div>
        </div>
      </div>
      
      {/* Card Preview */}
      <div className="flex flex-col items-center justify-center p-6 min-h-[calc(100vh-160px)]">
        <ShareCard
          currentRank={progress.currentRank}
          shieldStreakDays={progress.shieldStreakDays}
          strengthStreakDays={progress.strengthStreakDays}
          totalSP={progress.totalSP}
          weeklyChallengeId={progress.weeklyChallengeId as WeeklyChallengeType | null}
          weeklyProgress={progress.weeklyProgress}
        />
        
        {/* Info Text */}
        <p className="text-xs text-muted-foreground text-center mt-6 max-w-xs">
          This card shows only safe stats. No browsing history or explicit content is included.
        </p>
      </div>
      
      {/* Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-obsidian to-transparent">
        <div className="flex gap-3 max-w-md mx-auto">
          <Button
            variant="outline"
            className="flex-1 border-silver/30 text-silver hover:text-foreground"
            disabled
          >
            <Download className="w-4 h-4 mr-2" />
            Save Image
          </Button>
          <Button
            className="flex-1 bg-gold text-obsidian hover:bg-gold/90"
            disabled
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Sharing coming soon
        </p>
      </div>
    </div>
  );
}
