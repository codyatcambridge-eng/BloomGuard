/**
 * Trigger Categories for Content Moderation
 * 
 * Defines the 10 trigger groups and their individual checklist items.
 * Users can enable/disable each trigger to customize their protection.
 */

export type TriggerCategory = 
  | 'shirtless'
  | 'swimwear'
  | 'nudity'
  | 'suggestive_poses'
  | 'revealing_clothing'
  | 'fitness_content'
  | 'beach_pool'
  | 'underwear'
  | 'crop_tops'
  | 'tight_clothing';

export interface TriggerItem {
  id: string;
  label: string;
  description: string;
  category: TriggerCategory;
  defaultEnabled: boolean;
  /** Minimum dial level needed for this trigger to apply */
  minSensitivity: number;
}

export interface TriggerGroup {
  id: TriggerCategory;
  name: string;
  description: string;
  icon: string;
  items: TriggerItem[];
}

/**
 * The 10 trigger groups with their checklist items
 * MVP focuses on shirtless and swimwear
 */
export const TRIGGER_GROUPS: TriggerGroup[] = [
  {
    id: 'shirtless',
    name: 'Shirtless Content',
    description: 'Block shirtless individuals regardless of gender',
    icon: '👕',
    items: [
      { id: 'shirtless_male', label: 'Shirtless Males', description: 'Men without shirts', category: 'shirtless', defaultEnabled: true, minSensitivity: 1 },
      { id: 'shirtless_female', label: 'Shirtless Females', description: 'Women in sports bras or topless (covered)', category: 'shirtless', defaultEnabled: true, minSensitivity: 1 },
      { id: 'bare_chest', label: 'Bare Chest', description: 'Any visible bare chest area', category: 'shirtless', defaultEnabled: true, minSensitivity: 2 },
    ],
  },
  {
    id: 'swimwear',
    name: 'Swimwear',
    description: 'Block swimsuit and bikini content',
    icon: '👙',
    items: [
      { id: 'bikini', label: 'Bikinis', description: 'Two-piece swimsuits', category: 'swimwear', defaultEnabled: true, minSensitivity: 1 },
      { id: 'one_piece', label: 'One-piece Swimsuits', description: 'Full swimsuits', category: 'swimwear', defaultEnabled: true, minSensitivity: 2 },
      { id: 'swim_trunks', label: 'Swim Trunks', description: 'Male swimwear', category: 'swimwear', defaultEnabled: true, minSensitivity: 2 },
      { id: 'thong_bikini', label: 'Thong/Revealing Swimwear', description: 'Minimal coverage swimwear', category: 'swimwear', defaultEnabled: true, minSensitivity: 1 },
    ],
  },
  {
    id: 'nudity',
    name: 'Nudity',
    description: 'Block explicit nudity (always on by default)',
    icon: '🚫',
    items: [
      { id: 'full_nudity', label: 'Full Nudity', description: 'Complete nudity', category: 'nudity', defaultEnabled: true, minSensitivity: 1 },
      { id: 'partial_nudity', label: 'Partial Nudity', description: 'Partially exposed bodies', category: 'nudity', defaultEnabled: true, minSensitivity: 1 },
      { id: 'implied_nudity', label: 'Implied Nudity', description: 'Suggestive but covered', category: 'nudity', defaultEnabled: true, minSensitivity: 2 },
    ],
  },
  {
    id: 'suggestive_poses',
    name: 'Suggestive Poses',
    description: 'Block suggestive body positions',
    icon: '💃',
    items: [
      { id: 'seductive_pose', label: 'Seductive Poses', description: 'Intentionally alluring positions', category: 'suggestive_poses', defaultEnabled: true, minSensitivity: 2 },
      { id: 'bending_over', label: 'Bending Poses', description: 'Bent over positions', category: 'suggestive_poses', defaultEnabled: false, minSensitivity: 3 },
      { id: 'lying_down', label: 'Lying Down Poses', description: 'Reclining suggestive poses', category: 'suggestive_poses', defaultEnabled: false, minSensitivity: 3 },
    ],
  },
  {
    id: 'revealing_clothing',
    name: 'Revealing Clothing',
    description: 'Block low-cut or revealing outfits',
    icon: '👗',
    items: [
      { id: 'cleavage', label: 'Visible Cleavage', description: 'Low-cut tops showing cleavage', category: 'revealing_clothing', defaultEnabled: false, minSensitivity: 3 },
      { id: 'backless', label: 'Backless Outfits', description: 'Exposed back clothing', category: 'revealing_clothing', defaultEnabled: false, minSensitivity: 4 },
      { id: 'mini_skirt', label: 'Very Short Skirts', description: 'Mini skirts/dresses', category: 'revealing_clothing', defaultEnabled: false, minSensitivity: 4 },
    ],
  },
  {
    id: 'fitness_content',
    name: 'Fitness Content',
    description: 'Block workout and gym content',
    icon: '💪',
    items: [
      { id: 'gym_selfie', label: 'Gym Selfies', description: 'Fitness progress photos', category: 'fitness_content', defaultEnabled: false, minSensitivity: 3 },
      { id: 'workout_video', label: 'Workout Videos', description: 'Exercise demonstrations', category: 'fitness_content', defaultEnabled: false, minSensitivity: 4 },
      { id: 'athletic_wear', label: 'Tight Athletic Wear', description: 'Form-fitting sportswear', category: 'fitness_content', defaultEnabled: false, minSensitivity: 4 },
    ],
  },
  {
    id: 'beach_pool',
    name: 'Beach & Pool',
    description: 'Block beach and pool scenes',
    icon: '🏖️',
    items: [
      { id: 'beach_scene', label: 'Beach Scenes', description: 'Beach/ocean backgrounds', category: 'beach_pool', defaultEnabled: false, minSensitivity: 4 },
      { id: 'pool_scene', label: 'Pool Scenes', description: 'Pool/water park content', category: 'beach_pool', defaultEnabled: false, minSensitivity: 4 },
      { id: 'sunbathing', label: 'Sunbathing', description: 'Lying in sun/tanning', category: 'beach_pool', defaultEnabled: false, minSensitivity: 3 },
    ],
  },
  {
    id: 'underwear',
    name: 'Underwear',
    description: 'Block visible underwear content',
    icon: '🩲',
    items: [
      { id: 'visible_underwear', label: 'Visible Underwear', description: 'Underwear as main focus', category: 'underwear', defaultEnabled: true, minSensitivity: 2 },
      { id: 'lingerie', label: 'Lingerie', description: 'Decorative underwear', category: 'underwear', defaultEnabled: true, minSensitivity: 1 },
      { id: 'bra_visible', label: 'Visible Bra', description: 'Bra as primary garment', category: 'underwear', defaultEnabled: true, minSensitivity: 2 },
    ],
  },
  {
    id: 'crop_tops',
    name: 'Crop Tops & Midriff',
    description: 'Block exposed stomach/midriff',
    icon: '👚',
    items: [
      { id: 'crop_top', label: 'Crop Tops', description: 'Short tops showing midriff', category: 'crop_tops', defaultEnabled: false, minSensitivity: 4 },
      { id: 'exposed_midriff', label: 'Exposed Midriff', description: 'Visible stomach area', category: 'crop_tops', defaultEnabled: false, minSensitivity: 4 },
    ],
  },
  {
    id: 'tight_clothing',
    name: 'Tight/Form-Fitting',
    description: 'Block body-hugging clothing',
    icon: '👖',
    items: [
      { id: 'yoga_pants', label: 'Yoga Pants/Leggings', description: 'Tight leg-wear', category: 'tight_clothing', defaultEnabled: false, minSensitivity: 4 },
      { id: 'bodysuit', label: 'Bodysuits', description: 'Full-body tight wear', category: 'tight_clothing', defaultEnabled: false, minSensitivity: 4 },
      { id: 'compression_wear', label: 'Compression Clothing', description: 'Tight athletic compression', category: 'tight_clothing', defaultEnabled: false, minSensitivity: 4 },
    ],
  },
];

/**
 * Get all trigger items as a flat array
 */
export function getAllTriggerItems(): TriggerItem[] {
  return TRIGGER_GROUPS.flatMap(group => group.items);
}

/**
 * Get default enabled triggers
 */
export function getDefaultEnabledTriggers(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  getAllTriggerItems().forEach(item => {
    defaults[item.id] = item.defaultEnabled;
  });
  return defaults;
}

/**
 * MVP blocking categories - only these trigger auto-blur
 */
export const MVP_BLOCKING_CATEGORIES = ['shirtless', 'swimwear'] as const;
export type MVPBlockingCategory = typeof MVP_BLOCKING_CATEGORIES[number];

/**
 * Check if a category is an MVP blocking category
 */
export function isMVPBlockingCategory(category: string): boolean {
  return MVP_BLOCKING_CATEGORIES.includes(category as MVPBlockingCategory);
}

/**
 * Maps model predictions to trigger categories
 * Used to determine which user-selected triggers should be activated
 */
export function mapPredictionToTriggers(
  predictions: Record<string, number>,
  sensitivity: number
): { triggeredItems: string[]; primaryCategory: string; confidence: number } {
  const triggered: string[] = [];
  let primaryCategory = 'safe';
  let maxConfidence = 0;

  // Normalize predictions
  const norm: Record<string, number> = {};
  Object.entries(predictions).forEach(([k, v]) => {
    norm[k.toLowerCase()] = v;
  });

  const sexy = norm['sexy'] || 0;
  const porn = norm['porn'] || 0;
  const hentai = norm['hentai'] || 0;

  // Check for swimwear (high sexy, not porn)
  if (sexy > 0.25 && sexy < 0.7 && porn < 0.3) {
    triggered.push('swimwear', 'bikini', 'one_piece');
    if (sexy > maxConfidence) {
      primaryCategory = 'swimwear';
      maxConfidence = sexy;
    }
  }

  // Check for shirtless (moderate sexy)
  if (sexy > 0.15 && sexy < 0.5) {
    triggered.push('shirtless', 'shirtless_male', 'bare_chest');
    if (sexy > maxConfidence && primaryCategory !== 'swimwear') {
      primaryCategory = 'shirtless';
      maxConfidence = sexy;
    }
  }

  // Explicit content
  if (porn > 0.5 || hentai > 0.5) {
    triggered.push('nudity', 'full_nudity');
    primaryCategory = 'nudity';
    maxConfidence = Math.max(porn, hentai);
  }

  // Suggestive
  if (sexy > 0.4) {
    triggered.push('suggestive_poses', 'seductive_pose');
    if (maxConfidence === 0) {
      primaryCategory = 'suggestive';
      maxConfidence = sexy;
    }
  }

  return { triggeredItems: triggered, primaryCategory, confidence: maxConfidence };
}

/**
 * Platform-specific detection hints
 */
export const PLATFORM_SELECTORS: Record<string, string[]> = {
  youtube: ['ytd-thumbnail img', 'yt-img-shadow img', '#shorts-player img'],
  tiktok: ['[class*="DivVideoContainer"] img', '.video-card img', '[data-e2e="browse-video"] img'],
  instagram: ['article img', '[role="main"] img', '.x5yr21d img'],
  twitter: ['[data-testid="tweetPhoto"] img', 'article img'],
  facebook: ['[data-pagelet] img', '.x1ey2m1c img'],
  snapchat: ['.story-image img', '.snap-content img'],
  reddit: ['.media-preview-content img', '[data-click-id="media"] img'],
  pinterest: ['[data-test-id="pinWrapper"] img', '.PinImage img'],
  tumblr: ['.post-content img', '.tmblr-full img'],
  onlyfans: ['.post-media img', '.content-preview img'],
};

/**
 * Get selectors for a platform
 */
export function getPlatformSelectors(platform: string): string[] {
  return PLATFORM_SELECTORS[platform.toLowerCase()] || ['img'];
}
