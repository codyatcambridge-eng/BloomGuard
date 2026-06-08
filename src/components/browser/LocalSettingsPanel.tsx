import React, { useEffect, useState } from 'react';
import { useLocalSettings } from '@/hooks/useLocalSettings';

type TriggerKey =
  | 'sexualized_imagery'
  | 'nudity_partial'
  | 'suggestive_posing'
  | 'lingerie'
  | 'animated_suggestive'
  | 'revealing_outfits'
  | 'body_focused_angles'
  | 'tight_outfits'
  | 'fitness_sexualized'
  | 'swimwear_feeds'
  | 'social_explore'
  | 'shorts_feeds'
  | 'recommended'
  | 'comments'
  | 'live_streams'
  | 'image_search'
  | 'trending'
  | 'ads'
  | 'popup_ads'
  | 'sexual_text'
  | 'explicit_words'
  | 'late_night'
  | 'when_stressed'
  | 'browsers'
  | 'messaging_apps';

const STORAGE_KEY = 'mw_triggers_v1';

const ALL_TRIGGERS: { key: TriggerKey; label: string }[] = [
  { key: 'sexualized_imagery', label: 'Sexualized imagery (general)' },
  { key: 'nudity_partial', label: 'Nudity / partial nudity' },
  { key: 'suggestive_posing', label: 'Suggestive posing / “model-style” shots' },
  { key: 'lingerie', label: 'Lingerie-style content' },
  { key: 'animated_suggestive', label: 'Animated/AI-generated suggestive images' },
  { key: 'revealing_outfits', label: 'Revealing outfits' },
  { key: 'body_focused_angles', label: 'Body-focused camera angles' },
  { key: 'tight_outfits', label: 'Tight/skin-emphasizing outfits' },
  { key: 'fitness_sexualized', label: 'Fitness/“gym content” that\'s sexualized' },
  { key: 'swimwear_feeds', label: 'Swimwear-focused feeds' },
  { key: 'social_explore', label: 'Social media explore/discover pages' },
  { key: 'shorts_feeds', label: 'Short-form video feeds (auto-scroll)' },
  { key: 'recommended', label: '“Recommended for you” algorithms' },
  { key: 'comments', label: 'Comment sections' },
  { key: 'live_streams', label: 'Live streams' },
  { key: 'image_search', label: 'Image search results' },
  { key: 'trending', label: 'Trending pages' },
  { key: 'ads', label: 'Suggestive ads' },
  { key: 'popup_ads', label: 'Popups / banner ads' },
  { key: 'sexual_text', label: 'Sexualized captions/text' },
  { key: 'explicit_words', label: 'Explicit words (filtered keyword list)' },
  { key: 'late_night', label: 'Late night usage (custom cutoff time)' },
  { key: 'when_stressed', label: 'When stressed/anxious' },
  { key: 'browsers', label: 'Browsers (high-risk zones)' },
  { key: 'messaging_apps', label: 'Messaging apps (high-risk zones)' },
];

export default function LocalSettingsPanel() {
  const [triggers, setTriggers] = useState<Record<string, boolean>>({});
  const { settings, updateSetting } = useLocalSettings();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setTriggers(JSON.parse(raw));
      } else {
        // default: enable shirtless & swimwear related triggers
        const defaults: Record<string, boolean> = {};
        ALL_TRIGGERS.forEach(t => { defaults[t.key] = ['swimwear_feeds', 'revealing_outfits', 'revealing_outfits', 'sexualized_imagery'].includes(t.key); });
        setTriggers(defaults);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      }
    } catch (e) {
      console.error('[LocalSettingsPanel] load error', e);
    }
  }, []);

  const toggle = (key: string) => {
    const n = { ...triggers, [key]: !triggers[key] };
    setTriggers(n);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(n));
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ padding: 12, border: '1px solid #2dd4bf', borderRadius: 8, marginBottom: 16, background: 'rgba(45,212,191,0.06)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!settings.flash_shield_enabled}
            onChange={(e) => updateSetting('flash_shield_enabled', e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontWeight: 600 }}>Flash Shield — blur thumbnails on load (pre-paint)</span>
        </label>
        <p style={{ color: '#6b7280', margin: '6px 0 0 28px', fontSize: 13 }}>
          Blurs feed thumbnails the instant the page paints, before AI classification. Turn ON to fix blur-on-startup; safe images un-blur once classified.
        </p>
      </div>
      <h3>Trigger Blocklist</h3>
      <p style={{ color: '#6b7280' }}>Select which triggers should cause moderation behavior. For MVP, blocking focuses on Shirtless & Swimwear.</p>
      <div style={{ display: 'grid', gap: 6 }}>
        {ALL_TRIGGERS.map(t => (
          <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!!triggers[t.key]} onChange={() => toggle(t.key)} />
            <span>{t.label}</span>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <small style={{ color: '#6b7280' }}>
          Tip: enable only the triggers you want. For minimal blocking just enable "Swimwear-focused feeds" and "Revealing outfits".
        </small>
      </div>
    </div>
  );
}
