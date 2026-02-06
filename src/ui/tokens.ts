/**
 * Design Tokens - Cathedral-Tech War Room System
 * 
 * Single source of truth for spacing, radii, typography, shadows, and effects.
 * All values are semantic and accessible.
 */

// ==================== SPACING ====================

/**
 * Spacing scale (rem-based, 4px increments)
 * Usage: tokens.spacing.md -> '1rem' (16px)
 */
export const spacing = {
  none: '0',
  '3xs': '0.125rem',   // 2px
  '2xs': '0.25rem',    // 4px
  xs: '0.5rem',        // 8px
  sm: '0.75rem',       // 12px
  md: '1rem',          // 16px
  lg: '1.5rem',        // 24px
  xl: '2rem',          // 32px
  '2xl': '2.5rem',     // 40px
  '3xl': '3rem',       // 48px
  '4xl': '4rem',       // 64px
} as const;

/**
 * Touch target minimum (accessibility requirement)
 */
export const minTouchTarget = '44px';

// ==================== RADII ====================

/**
 * Border radius scale
 */
export const radii = {
  none: '0',
  sm: '0.25rem',       // 4px - subtle
  md: '0.375rem',      // 6px - default (cathedral stone)
  lg: '0.5rem',        // 8px - cards
  xl: '0.75rem',       // 12px - modals
  '2xl': '1rem',       // 16px - large panels
  full: '9999px',      // Circular
} as const;

// ==================== TYPOGRAPHY ====================

/**
 * Font families
 */
export const fontFamily = {
  display: "'Cinzel', serif",      // Headers, rank names
  body: "'Inter', sans-serif",     // Body text
  mono: "'JetBrains Mono', monospace", // Code, timers
} as const;

/**
 * Font sizes with line heights
 */
export const fontSize = {
  xs: ['0.75rem', { lineHeight: '1rem' }],        // 12px
  sm: ['0.875rem', { lineHeight: '1.25rem' }],    // 14px
  base: ['1rem', { lineHeight: '1.5rem' }],       // 16px
  lg: ['1.125rem', { lineHeight: '1.75rem' }],    // 18px
  xl: ['1.25rem', { lineHeight: '1.75rem' }],     // 20px
  '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px
  '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
  '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px
  '5xl': ['3rem', { lineHeight: '1' }],           // 48px
} as const;

/**
 * Font weights
 */
export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Letter spacing
 */
export const letterSpacing = {
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} as const;

// ==================== SHADOWS ====================

/**
 * Shadow tokens for depth and glow effects
 */
export const shadows = {
  // Depth shadows
  none: 'none',
  sm: '0 1px 2px hsl(220 100% 3% / 0.3)',
  md: '0 4px 6px hsl(220 100% 3% / 0.4)',
  lg: '0 10px 15px hsl(220 100% 3% / 0.5)',
  xl: '0 20px 25px hsl(220 100% 3% / 0.6)',
  
  // Card shadows
  card: '0 4px 20px hsl(220 100% 3% / 0.6)',
  cardHover: '0 8px 30px hsl(220 100% 3% / 0.7)',
  
  // Inner shadows
  inner: 'inset 0 2px 4px hsl(220 100% 3% / 0.3)',
  innerDeep: 'inset 0 4px 8px hsl(220 100% 2% / 0.5)',
  
  // Glow effects
  glowGold: '0 0 20px hsl(45 100% 50% / 0.3)',
  glowGoldStrong: '0 0 40px hsl(45 100% 50% / 0.5)',
  glowBlue: '0 0 15px hsl(200 100% 50% / 0.3)',
  glowSilver: '0 0 10px hsl(220 10% 60% / 0.2)',
} as const;

// ==================== GLOW EFFECTS ====================

/**
 * Glow intensity by rank
 */
export const glowIntensity = {
  stone: 0,       // No glow
  bronze: 0.15,   // Subtle
  iron: 0.3,      // Moderate
  gold: 0.5,      // Strong
  champ: 0.7,     // Maximum
} as const;

// ==================== Z-INDEX ====================

/**
 * Z-index scale for layering
 */
export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  toast: 80,
  max: 9999,
} as const;

// ==================== TRANSITIONS ====================

/**
 * Transition timing functions
 */
export const easing = {
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
} as const;

/**
 * Transition durations
 */
export const duration = {
  instant: '0ms',
  fast: '100ms',
  normal: '200ms',
  slow: '300ms',
  slower: '500ms',
} as const;

// ==================== OPACITY ====================

/**
 * Opacity scale
 */
export const opacity = {
  0: '0',
  5: '0.05',
  10: '0.1',
  20: '0.2',
  30: '0.3',
  40: '0.4',
  50: '0.5',
  60: '0.6',
  70: '0.7',
  80: '0.8',
  90: '0.9',
  100: '1',
} as const;

// ==================== BARREL EXPORT ====================

export const tokens = {
  spacing,
  radii,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  shadows,
  glowIntensity,
  zIndex,
  easing,
  duration,
  opacity,
  minTouchTarget,
} as const;

export default tokens;
