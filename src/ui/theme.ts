/**
 * Rank Theme System - Cathedral-Tech Visual Variants
 * 
 * Each rank has a distinct visual identity:
 * - STONE: Grayscale, minimal, foundational
 * - BRONZE: Subtle warm accent, emerging strength
 * - IRON: Strong visuals, glow on progress
 * - GOLD: Premium cathedral-tech, radiant
 * - CHAMP: Highest polish, emblem worthy
 */

import { RankId } from '@/models/UserProgress';

// ==================== THEME TYPES ====================

export interface RankTheme {
  id: RankId;
  name: string;
  
  // Primary colors (HSL values)
  accentHue: number;
  accentSaturation: number;
  accentLightness: number;
  
  // Glow and effects
  glowOpacity: number;
  glowSpread: number;
  shimmerEnabled: boolean;
  
  // Border styling
  borderOpacity: number;
  borderGradient: boolean;
  
  // Text styling
  headerColor: string;
  accentColor: string;
  
  // CSS classes
  cardClass: string;
  buttonClass: string;
  progressClass: string;
  badgeClass: string;
}

// ==================== THEME DEFINITIONS ====================

export const RANK_THEMES: Record<RankId, RankTheme> = {
  STONE: {
    id: 'STONE',
    name: 'Stone',
    
    // Grayscale palette
    accentHue: 220,
    accentSaturation: 10,
    accentLightness: 50,
    
    // Minimal effects
    glowOpacity: 0,
    glowSpread: 0,
    shimmerEnabled: false,
    
    // Subtle borders
    borderOpacity: 0.2,
    borderGradient: false,
    
    // Muted text
    headerColor: 'text-silver',
    accentColor: 'text-silver',
    
    // Classes
    cardClass: 'theme-stone-card',
    buttonClass: 'theme-stone-button',
    progressClass: 'theme-stone-progress',
    badgeClass: 'theme-stone-badge',
  },
  
  BRONZE: {
    id: 'BRONZE',
    name: 'Bronze',
    
    // Warm bronze palette
    accentHue: 30,
    accentSaturation: 60,
    accentLightness: 45,
    
    // Subtle glow
    glowOpacity: 0.15,
    glowSpread: 10,
    shimmerEnabled: false,
    
    // Visible borders
    borderOpacity: 0.3,
    borderGradient: false,
    
    // Warm text
    headerColor: 'text-accent-bronze',
    accentColor: 'text-accent-bronze',
    
    // Classes
    cardClass: 'theme-bronze-card',
    buttonClass: 'theme-bronze-button',
    progressClass: 'theme-bronze-progress',
    badgeClass: 'theme-bronze-badge',
  },
  
  IRON: {
    id: 'IRON',
    name: 'Iron',
    
    // Cool steel palette
    accentHue: 200,
    accentSaturation: 30,
    accentLightness: 55,
    
    // Moderate glow
    glowOpacity: 0.25,
    glowSpread: 15,
    shimmerEnabled: true,
    
    // Strong borders
    borderOpacity: 0.4,
    borderGradient: true,
    
    // Steel text
    headerColor: 'text-techBlue',
    accentColor: 'text-techBlue',
    
    // Classes
    cardClass: 'theme-iron-card',
    buttonClass: 'theme-iron-button',
    progressClass: 'theme-iron-progress',
    badgeClass: 'theme-iron-badge',
  },
  
  GOLD: {
    id: 'GOLD',
    name: 'Gold',
    
    // Radiant gold palette
    accentHue: 45,
    accentSaturation: 100,
    accentLightness: 50,
    
    // Strong glow
    glowOpacity: 0.4,
    glowSpread: 25,
    shimmerEnabled: true,
    
    // Premium borders
    borderOpacity: 0.5,
    borderGradient: true,
    
    // Gold text
    headerColor: 'text-gold',
    accentColor: 'text-gold',
    
    // Classes
    cardClass: 'theme-gold-card',
    buttonClass: 'theme-gold-button',
    progressClass: 'theme-gold-progress',
    badgeClass: 'theme-gold-badge',
  },
  
  CHAMP: {
    id: 'CHAMP',
    name: 'Champion',
    
    // Ultimate palette (gold + white radiance)
    accentHue: 45,
    accentSaturation: 100,
    accentLightness: 60,
    
    // Maximum glow
    glowOpacity: 0.6,
    glowSpread: 35,
    shimmerEnabled: true,
    
    // Glowing borders
    borderOpacity: 0.6,
    borderGradient: true,
    
    // Champion text
    headerColor: 'text-gold',
    accentColor: 'text-gold',
    
    // Classes
    cardClass: 'theme-champ-card',
    buttonClass: 'theme-champ-button',
    progressClass: 'theme-champ-progress',
    badgeClass: 'theme-champ-badge',
  },
};

// ==================== THEME HELPERS ====================

/**
 * Get theme for a rank
 */
export function getThemeForRank(rankId: RankId): RankTheme {
  return RANK_THEMES[rankId];
}

/**
 * Generate CSS custom properties for a theme
 */
export function getThemeCSSVars(theme: RankTheme): Record<string, string> {
  return {
    '--theme-accent-hue': String(theme.accentHue),
    '--theme-accent-sat': `${theme.accentSaturation}%`,
    '--theme-accent-light': `${theme.accentLightness}%`,
    '--theme-glow-opacity': String(theme.glowOpacity),
    '--theme-glow-spread': `${theme.glowSpread}px`,
    '--theme-border-opacity': String(theme.borderOpacity),
  };
}

/**
 * Get accent color as HSL string
 */
export function getAccentColor(theme: RankTheme, alpha: number = 1): string {
  return `hsl(${theme.accentHue} ${theme.accentSaturation}% ${theme.accentLightness}% / ${alpha})`;
}

/**
 * Get glow shadow for theme
 */
export function getThemeGlow(theme: RankTheme): string {
  if (theme.glowOpacity === 0) return 'none';
  
  const color = getAccentColor(theme, theme.glowOpacity);
  return `0 0 ${theme.glowSpread}px ${color}`;
}

/**
 * Check if effects should be reduced based on preference
 */
export function shouldReduceMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get appropriate animation class based on motion preference
 */
export function getAnimationClass(animationClass: string): string {
  if (shouldReduceMotion()) return '';
  return animationClass;
}

// ==================== RANK PROGRESSION ====================

/**
 * Get visual intensity multiplier based on rank (0-1)
 */
export function getRankIntensity(rankId: RankId): number {
  const intensities: Record<RankId, number> = {
    STONE: 0,
    BRONZE: 0.25,
    IRON: 0.5,
    GOLD: 0.75,
    CHAMP: 1,
  };
  return intensities[rankId];
}

/**
 * Interpolate between two values based on rank intensity
 */
export function interpolateByRank(
  rankId: RankId,
  minValue: number,
  maxValue: number
): number {
  const intensity = getRankIntensity(rankId);
  return minValue + (maxValue - minValue) * intensity;
}
