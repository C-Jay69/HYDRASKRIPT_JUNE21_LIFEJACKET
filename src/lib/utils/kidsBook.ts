// HydraSkript - Kids Book helpers
// Shared utilities for the children's book (0-5 / 6-9 / 10-14) generation path.

import { KIDS_ADVENTURES, type TargetAudience } from '@/types';

export const KIDS_AUDIENCES: readonly TargetAudience[] = ['0-5', '6-9', '10-14'] as const;

export function isKidsAudience(audience: string | null | undefined): audience is Exclude<TargetAudience, 'adult'> {
  return !!audience && (KIDS_AUDIENCES as readonly string[]).includes(audience);
}

/**
 * Build the sentinel token the outliner is asked to prefix each synopsis with.
 * Used purely as a compliance check — it must never leak into prose or images.
 */
export function getAdventureToken(adventureType: string): string {
  return `AdventureSettingToken: ${adventureType.replace(/[^\w\s]/g, '').toUpperCase()}`;
}

/**
 * Human-readable setting phrase for an adventure value, e.g. "farm" -> "on the farm".
 * Falls back to the raw value (dashes -> spaces) for unknown settings.
 */
export function getAdventureLabel(adventureType: string | null | undefined): string {
  if (!adventureType) return '';
  const match = KIDS_ADVENTURES.find((a) => a.value === adventureType);
  if (match) return match.label.toLowerCase(); // "On the Farm" -> "on the farm"
  return adventureType.replace(/-/g, ' ').toLowerCase();
}

/**
 * Remove any AdventureSettingToken sentinel (and trailing separator) from text.
 * The token is an LLM compliance marker, not story content.
 */
export function stripAdventureToken(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/\bAdventureSettingToken:\s*[A-Z0-9 _]+\s*(?:[-–—:|]\s*)?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Age-specific art direction for chapter illustrations.
 */
export function getKidsIllustrationStyleNote(audience: TargetAudience): string {
  switch (audience) {
    case '0-5':
      return 'Picture book illustration for toddlers: big simple shapes, bold bright primary colors, friendly rounded characters, minimal background clutter, warm and gentle mood.';
    case '6-9':
      return 'Early reader chapter book illustration: colorful, playful, expressive characters, clear focal action, whimsical details, cheerful lighting.';
    case '10-14':
      return 'Middle-grade book illustration: dynamic composition, richer detail and atmosphere, adventurous mood, expressive characters, cinematic lighting.';
    default:
      return '';
  }
}

/**
 * Compose a complete, safe illustration prompt for a kids book chapter.
 * - Strips the sentinel token from the scene description.
 * - Anchors the hero + friends for character consistency.
 * - Pins the adventure setting so every image shares the same world.
 * - Adds age-appropriate art direction and safety guards.
 */
export function buildKidsIllustrationPrompt(params: {
  scene: string;
  audience: TargetAudience;
  adventureType?: string | null;
  characterNames?: string[];
  bookTitle?: string;
}): string {
  const { scene, audience, adventureType, characterNames = [], bookTitle } = params;
  const parts: string[] = [];

  const cleanScene = stripAdventureToken(scene);
  if (bookTitle) parts.push(`Illustration for the children's book "${bookTitle}".`);
  parts.push(`Scene: ${cleanScene || 'A joyful moment from the story'}.`);

  const setting = getAdventureLabel(adventureType);
  if (setting) parts.push(`Setting: ${setting}.`);

  const [hero, ...friends] = characterNames.map((n) => n.trim()).filter(Boolean);
  if (hero) {
    parts.push(`Main character: ${hero}, a child protagonist who must look identical in every illustration.`);
    if (friends.length > 0) parts.push(`Friends who may appear: ${friends.join(', ')}.`);
  }

  const styleNote = getKidsIllustrationStyleNote(audience);
  if (styleNote) parts.push(styleNote);

  parts.push('Family-friendly, wholesome, no text, no letters, no watermarks, no scary or violent imagery.');
  return parts.join(' ');
}

/**
 * Compose the cover prompt for a kids storybook.
 */
export function buildKidsCoverPrompt(params: {
  bookTitle: string;
  audience: TargetAudience;
  adventureType?: string | null;
  characterNames?: string[];
  description?: string | null;
}): string {
  const { bookTitle, audience, adventureType, characterNames = [], description } = params;
  const parts: string[] = [`Children's picture book cover art for "${bookTitle}".`];

  const setting = getAdventureLabel(adventureType);
  if (setting) parts.push(`The story takes place ${setting}; show that setting clearly.`);

  const hero = characterNames.map((n) => n.trim()).filter(Boolean)[0];
  if (hero) parts.push(`Feature the main character ${hero}, a cheerful child hero, front and center.`);

  if (description && description.trim()) parts.push(`Story concept: ${description.trim().slice(0, 300)}.`);

  const styleNote = getKidsIllustrationStyleNote(audience);
  if (styleNote) parts.push(styleNote);

  parts.push('Bright, colorful, inviting composition with room at the top for a title. No text, no letters, no watermarks.');
  return parts.join(' ');
}
