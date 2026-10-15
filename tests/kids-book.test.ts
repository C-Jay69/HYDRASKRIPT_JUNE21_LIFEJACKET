import {
  buildKidsCoverPrompt,
  buildKidsIllustrationPrompt,
  getAdventureLabel,
  getAdventureToken,
  isKidsAudience,
  stripAdventureToken,
} from '@/lib/utils/kidsBook';
import { getChapterWritePrompt, getOutlinePrompt } from '@/lib/llm/prompts';

describe('kids book helpers', () => {
  test('isKidsAudience recognises only the kids ranges', () => {
    expect(isKidsAudience('0-5')).toBe(true);
    expect(isKidsAudience('6-9')).toBe(true);
    expect(isKidsAudience('10-14')).toBe(true);
    expect(isKidsAudience('adult')).toBe(false);
    expect(isKidsAudience('')).toBe(false);
    expect(isKidsAudience(undefined)).toBe(false);
  });

  test('getAdventureLabel maps values to readable setting phrases', () => {
    expect(getAdventureLabel('farm')).toBe('on the farm');
    expect(getAdventureLabel('space')).toBe('in space');
    expect(getAdventureLabel('some-other')).toBe('some other');
    expect(getAdventureLabel(null)).toBe('');
  });

  test('stripAdventureToken removes the sentinel but keeps the story text', () => {
    const token = getAdventureToken('farm');
    expect(token).toBe('AdventureSettingToken: FARM');
    expect(stripAdventureToken(`${token} - Lily finds a baby chick.`)).toBe('Lily finds a baby chick.');
    expect(stripAdventureToken(`${token}: Lily finds a baby chick.`)).toBe('Lily finds a baby chick.');
    expect(stripAdventureToken('adventuresettingtoken: farm — Lily waves.')).toBe('Lily waves.');
    expect(stripAdventureToken('No token here.')).toBe('No token here.');
    expect(stripAdventureToken(null)).toBe('');
  });

  test('buildKidsIllustrationPrompt anchors hero, setting and age style; never leaks token', () => {
    const prompt = buildKidsIllustrationPrompt({
      scene: 'AdventureSettingToken: FARM - Lily meets a shy calf.',
      audience: '0-5',
      adventureType: 'farm',
      characterNames: ['Lily', 'Max', ''],
      bookTitle: 'Lily on the Farm',
    });
    expect(prompt).not.toMatch(/AdventureSettingToken/i);
    expect(prompt).toContain('Lily meets a shy calf');
    expect(prompt).toContain('Setting: on the farm');
    expect(prompt).toContain('Main character: Lily');
    expect(prompt).toContain('Friends who may appear: Max');
    expect(prompt).toMatch(/toddlers/i);
    expect(prompt).toMatch(/no text/i);
  });

  test('buildKidsIllustrationPrompt works with no personalisation', () => {
    const prompt = buildKidsIllustrationPrompt({ scene: 'A dragon sneezes.', audience: '10-14' });
    expect(prompt).toContain('A dragon sneezes');
    expect(prompt).not.toContain('Main character');
    expect(prompt).not.toContain('Setting:');
  });

  test('buildKidsCoverPrompt includes title, hero and setting', () => {
    const prompt = buildKidsCoverPrompt({
      bookTitle: 'Zara in Space',
      audience: '6-9',
      adventureType: 'space',
      characterNames: ['Zara'],
      description: 'A brave girl explores the moon.',
    });
    expect(prompt).toContain('"Zara in Space"');
    expect(prompt).toContain('takes place in space');
    expect(prompt).toContain('main character Zara');
    expect(prompt).toContain('A brave girl explores the moon');
  });
});

describe('kids book prompts', () => {
  test('outline prompt uses a grammatical setting phrase and the sentinel token', () => {
    const prompt = getOutlinePrompt('children', '6-9', 15, '', ['Lily', 'Max'], 'farm', 'A chick goes missing.');
    expect(prompt).toContain('The story takes place on the farm');
    expect(prompt).toContain('AdventureSettingToken: FARM');
    expect(prompt).toContain('Lily, Max');
    expect(prompt).toContain('A chick goes missing.');
    expect(prompt).toContain('exactly 15 chapters');
  });

  test('chapter prompt pins the adventure setting independently of the token', () => {
    const prompt = getChapterWritePrompt('', 'Lily on the Farm', 'children', 2, 15, 'prev', ['Lily'], {
      currentSynopsis: 'Chapter 3: Lily finds the chick.',
      adventureType: 'farm',
    });
    expect(prompt).toContain('SETTING: The entire story takes place on the farm');
    expect(prompt).not.toMatch(/AdventureSettingToken/);
  });

  test('chapter prompt omits the setting note for adult books', () => {
    const prompt = getChapterWritePrompt('', 'Noir', 'noir', 0, 10, 'start', undefined, {});
    expect(prompt).not.toContain('SETTING:');
  });
});
