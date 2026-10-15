jest.mock('@/lib/utils/storage', () => ({
  saveBase64File: jest.fn(),
  generateFilename: jest.fn(),
  createMediaAsset: jest.fn(),
}));
jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

import { getImageProviderChain, readEnvKey } from '@/lib/services/imageService';

const KEYS = ['STABILITY_AI_API_KEY', 'PRUNA_AI_API_KEY', 'GOOGLE_AI_API_KEY', 'IMAGE_PROVIDER_ORDER', 'IMAGE_ALLOW_FREE_FALLBACK'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('image provider chain', () => {
  test('readEnvKey strips wrapping quotes and whitespace', () => {
    process.env.STABILITY_AI_API_KEY = ' "sk-abc" ';
    expect(readEnvKey('STABILITY_AI_API_KEY')).toBe('sk-abc');
    process.env.STABILITY_AI_API_KEY = '""';
    expect(readEnvKey('STABILITY_AI_API_KEY')).toBeUndefined();
  });

  test('defaults to Stability → Pruna → Gemini → Pollinations when all keys present', () => {
    process.env.STABILITY_AI_API_KEY = 'sk-x';
    process.env.PRUNA_AI_API_KEY = 'pru_x';
    process.env.GOOGLE_AI_API_KEY = 'g';
    expect(getImageProviderChain().chain).toEqual(['stability', 'pruna', 'gemini', 'pollinations']);
  });

  test('skips providers whose key is missing and reports why', () => {
    process.env.PRUNA_AI_API_KEY = 'pru_x';
    const { chain, skipped } = getImageProviderChain();
    expect(chain).toEqual(['pruna', 'pollinations']);
    expect(skipped.join(' ')).toMatch(/STABILITY_AI_API_KEY not set/);
  });

  test('IMAGE_ALLOW_FREE_FALLBACK=false restricts to paid backends', () => {
    process.env.STABILITY_AI_API_KEY = 'sk-x';
    process.env.PRUNA_AI_API_KEY = 'pru_x';
    process.env.GOOGLE_AI_API_KEY = 'g';
    process.env.IMAGE_ALLOW_FREE_FALLBACK = 'false';
    expect(getImageProviderChain().chain).toEqual(['stability', 'pruna']);
  });

  test('IMAGE_PROVIDER_ORDER overrides order and ignores unknown names', () => {
    process.env.STABILITY_AI_API_KEY = 'sk-x';
    process.env.PRUNA_AI_API_KEY = 'pru_x';
    process.env.IMAGE_PROVIDER_ORDER = 'pruna, bogus, stability';
    expect(getImageProviderChain().chain).toEqual(['pruna', 'stability']);
  });
});
