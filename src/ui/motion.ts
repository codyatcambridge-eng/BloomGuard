/**
 * Motion System - Accessible Animations
 * 
 * All animations respect prefers-reduced-motion.
 * Provides subtle, premium motion for cathedral-tech aesthetic.
 */

import { shouldReduceMotion } from './theme';

// ==================== MOTION TYPES ====================

export interface AnimationConfig {
  duration: number;     // milliseconds
  easing: string;
  delay?: number;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

// ==================== DURATION PRESETS ====================

export const durations = {
  instant: 0,
  fast: 100,
  normal: 200,
  slow: 300,
  slower: 500,
  slowest: 800,
} as const;

// ==================== EASING PRESETS ====================

export const easings = {
  // Standard easings
  linear: 'linear',
  ease: 'ease',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',
  
  // Custom cathedral-tech easings
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
  spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  
  // Premium feel
  premium: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
} as const;

// ==================== SPRING PRESETS ====================

export const springs = {
  // Framer Motion spring configs
  gentle: { stiffness: 120, damping: 14 },
  wobbly: { stiffness: 180, damping: 12 },
  stiff: { stiffness: 300, damping: 20 },
  slow: { stiffness: 80, damping: 20 },
  
  // Cathedral-tech springs
  cathedral: { stiffness: 150, damping: 18 },
  pulse: { stiffness: 200, damping: 10 },
} as const;

// ==================== ANIMATION PRESETS ====================

/**
 * Pre-configured animation variants for common patterns
 * All respect reduced motion automatically
 */
export const animations = {
  // Fade animations
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  
  fadeInUp: {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 10 },
  },
  
  fadeInDown: {
    initial: { opacity: 0, y: -10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
  },
  
  // Scale animations
  scaleIn: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
  
  popIn: {
    initial: { opacity: 0, scale: 0.8 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.8 },
  },
  
  // Slide animations
  slideInRight: {
    initial: { x: '100%' },
    animate: { x: 0 },
    exit: { x: '100%' },
  },
  
  slideInLeft: {
    initial: { x: '-100%' },
    animate: { x: 0 },
    exit: { x: '-100%' },
  },
  
  slideInUp: {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
  },
  
  // Glow animations (cathedral-tech specific)
  glowPulse: {
    initial: { boxShadow: '0 0 0 hsla(45, 100%, 50%, 0)' },
    animate: { 
      boxShadow: [
        '0 0 20px hsla(45, 100%, 50%, 0.3)',
        '0 0 40px hsla(45, 100%, 50%, 0.5)',
        '0 0 20px hsla(45, 100%, 50%, 0.3)',
      ],
    },
  },
  
  // Progress animations
  progressFill: {
    initial: { scaleX: 0 },
    animate: { scaleX: 1 },
  },
} as const;

// ==================== TRANSITION HELPERS ====================

/**
 * Get safe animation duration (0 if reduced motion)
 */
export function getSafeDuration(duration: number): number {
  if (shouldReduceMotion()) return 0;
  return duration;
}

/**
 * Get transition config with reduced motion support
 */
export function getTransition(config: AnimationConfig): AnimationConfig {
  if (shouldReduceMotion()) {
    return { ...config, duration: 0 };
  }
  return config;
}

/**
 * Standard transition for most UI elements
 */
export function standardTransition(duration: number = durations.normal) {
  return getTransition({
    duration,
    easing: easings.smooth,
  });
}

/**
 * Premium transition for important elements
 */
export function premiumTransition(duration: number = durations.slow) {
  return getTransition({
    duration,
    easing: easings.premium,
  });
}

// ==================== CSS HELPERS ====================

/**
 * Generate CSS transition string
 */
export function cssTransition(
  properties: string | string[],
  duration: number = durations.normal,
  easing: string = easings.smooth,
  delay: number = 0
): string {
  if (shouldReduceMotion()) {
    duration = 0;
  }
  
  const props = Array.isArray(properties) ? properties : [properties];
  const durationMs = `${duration}ms`;
  const delayMs = delay ? `${delay}ms` : '';
  
  return props
    .map(prop => `${prop} ${durationMs} ${easing}${delayMs ? ` ${delayMs}` : ''}`)
    .join(', ');
}

/**
 * Common transition properties
 */
export const transitionPresets = {
  all: 'all',
  colors: 'color, background-color, border-color, text-decoration-color, fill, stroke',
  opacity: 'opacity',
  shadow: 'box-shadow',
  transform: 'transform',
} as const;

// ==================== STAGGER HELPERS ====================

/**
 * Calculate stagger delay for list items
 */
export function staggerDelay(index: number, baseDelay: number = 50): number {
  if (shouldReduceMotion()) return 0;
  return index * baseDelay;
}

/**
 * Get stagger children config for Framer Motion
 */
export function staggerChildren(staggerMs: number = 50) {
  if (shouldReduceMotion()) {
    return { staggerChildren: 0 };
  }
  return { staggerChildren: staggerMs / 1000 };
}

// ==================== SCROLL ANIMATIONS ====================

/**
 * Check if element should animate on scroll
 */
export function shouldAnimateOnScroll(): boolean {
  return !shouldReduceMotion();
}

// ==================== BREATHING ANIMATION ====================

/**
 * Get breathing animation for focus/meditation states
 */
export function breathingAnimation(cycleDuration: number = 4000) {
  if (shouldReduceMotion()) {
    return { animate: {} };
  }
  
  return {
    animate: {
      scale: [1, 1.05, 1],
      opacity: [0.8, 1, 0.8],
    },
    transition: {
      duration: cycleDuration / 1000,
      repeat: Infinity,
      ease: easings.easeInOut,
    },
  };
}

// ==================== PULSE ANIMATION ====================

/**
 * Get pulse animation for attention
 */
export function pulseAnimation(intensity: number = 0.05) {
  if (shouldReduceMotion()) {
    return { animate: {} };
  }
  
  return {
    animate: {
      scale: [1, 1 + intensity, 1],
    },
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: easings.easeInOut,
    },
  };
}

// ==================== BARREL EXPORT ====================

export const motion = {
  durations,
  easings,
  springs,
  animations,
  getSafeDuration,
  getTransition,
  standardTransition,
  premiumTransition,
  cssTransition,
  transitionPresets,
  staggerDelay,
  staggerChildren,
  shouldAnimateOnScroll,
  shouldReduceMotion,
  breathingAnimation,
  pulseAnimation,
} as const;

export default motion;
