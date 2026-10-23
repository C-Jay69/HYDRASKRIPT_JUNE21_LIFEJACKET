// Tests for the illustration QA gate.
//
// The failure this guards against, seen in production: the image backend
// returned a perfectly valid picture of entirely the wrong thing (a generic
// girl-with-animal-friends portrait — bear, dinosaur, tiger — for an
// under-the-table search scene with a girl, her father and their black lab).
// The gate re-rolls those frames; just as important, it is FAIL-OPEN — QA
// outages must degrade to the old one-shot behaviour, never block a book.

import { buildQAPrompt, parseQAVerdict, verifyIllustration } from '@/lib/services/imageQA';
import type { CharacterSheetEntry } from '@/lib/services/characterSheet';

const CAST: CharacterSheetEntry[] = [
  { name: 'Victoria', countNoun: 'girl', isAnimal: false, descriptor: 'a 4 year old girl' },
  { name: 'Dada', countNoun: 'man', isAnimal: false, descriptor: 'a red haired irishman' },
  { name: 'Truffle', countNoun: 'dog', isAnimal: true, descriptor: 'a black lab/retriever' },
];
const SCENE = 'The scene contains exactly one girl, exactly one man and exactly one dog. Victoria and Dada peek under the big wooden table in the castle hallway while Truffle sniffs the floor for his red ball.';
const IMAGE_URL = 'https://example.test/media/chapter-4.png';

function chatResponse(content: string, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

describe('parseQAVerdict', () => {
  it('parses a clean verdict', () => {
    expect(parseQAVerdict('{"match": true, "problems": []}')).toEqual({ match: true, problems: [] });
    expect(parseQAVerdict('{"match": false, "problems": ["two dogs"]}')).toEqual({ match: false, problems: ['two dogs'] });
  });

  it('salvages a fenced, chatty verdict', () => {
    const raw = 'Here is my verdict:\n```json\n{"match": false, "problems": ["a tiger is present instead of the dog"]}\n```';
    expect(parseQAVerdict(raw)).toEqual({ match: false, problems: ['a tiger is present instead of the dog'] });
  });

  it('returns null for garbage or a non-boolean match', () => {
    expect(parseQAVerdict('The picture looks fine to me.')).toBeNull();
    expect(parseQAVerdict('{"match": "yes"}')).toBeNull();
    expect(parseQAVerdict('')).toBeNull();
  });

  it('drops non-string problems', () => {
    expect(parseQAVerdict('{"match": false, "problems": ["real problem", 42, null]}')).toEqual({
      match: false,
      problems: ['real problem'],
    });
  });
});

describe('buildQAPrompt', () => {
  it('lists the cast census with kinds and descriptors, plus the scene', () => {
    const { system, user } = buildQAPrompt(SCENE, CAST);
    expect(user).toContain('- Victoria: a girl — a 4 year old girl');
    expect(user).toContain('- Truffle: a dog (animal) — a black lab/retriever');
    expect(user).toContain('peek under the big wooden table');
    expect(system).toMatch(/exactly once/i);
    expect(system).toMatch(/wrong species/i);
    expect(system).toMatch(/ONLY a JSON object/i);
    // Identity checks added after a book shipped the heroine as a ginger,
    // then a boy, then a different skin tone — QA's old checklist never
    // asked, so even checked frames sailed through.
    expect(system).toMatch(/drawn as a boy/i);
    expect(system).toMatch(/hair colour/i);
    expect(system).toMatch(/skin tone/i);
    expect(system).toMatch(/no lighting could explain/i);
  });
});

describe('verifyIllustration', () => {
  const originalEnv = { ...process.env };
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
    delete process.env.IMAGE_QA_ENABLED;
    delete process.env.IMAGE_QA_MODEL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts a frame the vision model matches', async () => {
    mockFetch.mockResolvedValue(chatResponse('{"match": true, "problems": []}'));
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: true, checked: true });
    // The image actually went to the model as an image_url part.
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: IMAGE_URL } });
  });

  it('rejects a rogue frame with the model’s reasons', async () => {
    mockFetch.mockResolvedValue(
      chatResponse('{"match": false, "problems": ["a tiger, a bear and a dinosaur are present instead of the dog", "the father is missing"]}')
    );
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: false, checked: true });
    expect(result.reason).toContain('tiger');
  });

  it('falls through to the next vision model when the first errors', async () => {
    mockFetch
      .mockResolvedValueOnce(chatResponse('rate limited', false, 429))
      .mockResolvedValueOnce(chatResponse('{"match": true, "problems": []}'));
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: true, checked: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fails open when every model is down', async () => {
    mockFetch.mockRejectedValue(new Error('network unreachable'));
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: true, checked: false });
  });

  it('fails open when verdicts are unparseable', async () => {
    mockFetch.mockResolvedValue(chatResponse('Lovely picture!'));
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: true, checked: false });
  });

  it('skips the check entirely without an API key or when disabled', async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    await expect(verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST })).resolves.toMatchObject({
      accept: true,
      checked: false,
    });

    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.IMAGE_QA_ENABLED = 'false';
    await expect(verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST })).resolves.toMatchObject({
      accept: true,
      checked: false,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips the check when there is no cast to verify', async () => {
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: [] });
    expect(result).toMatchObject({ accept: true, checked: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('asks a paid vision model before the free Gemma', async () => {
    // Paid judges fail fast (402) on an empty balance; the free Gemma fails
    // slowly (502/504 storms) — leading with it once left QA silently
    // unchecked through a whole book.
    mockFetch.mockResolvedValue(chatResponse('{"match": true, "problems": []}'));
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: true, checked: true });
    const firstBody = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(firstBody.model).toBe('google/gemini-2.5-flash');
  });

  it('reaches the free Gemma when the paid judges report no credits', async () => {
    mockFetch
      .mockResolvedValueOnce(chatResponse('insufficient credits', false, 402))
      .mockResolvedValueOnce(chatResponse('insufficient credits', false, 402))
      .mockResolvedValueOnce(chatResponse('{"match": false, "problems": ["an extra boy is present"]}'));
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: false, checked: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const thirdBody = JSON.parse((mockFetch.mock.calls[2][1] as { body: string }).body);
    expect(thirdBody.model).toBe('google/gemma-4-31b-it:free');
  });

  it('rejects an identity swap (the production playground recast)', async () => {
    // Census-perfect frame — one child, right scene — but the heroine was
    // recast as a different child. The round-3 checklist waved this through
    // because it never asked about gender, hair or skin.
    mockFetch.mockResolvedValue(
      chatResponse('{"match": false, "problems": ["the girl is drawn as a boy with short ginger hair instead of a girl with long black braids"]}')
    );
    const result = await verifyIllustration({ imageUrl: IMAGE_URL, scene: SCENE, cast: CAST });
    expect(result).toMatchObject({ accept: false, checked: true });
    expect(result.reason).toContain('boy');
  });

  it('tells the judge clothing is never a failure (outfit churn burned paid frames)', () => {
    // Production: frames rejected for "capri pants, not denim shorts" and
    // "white t-shirt instead of pink" while the right girl stood there.
    const { system } = buildQAPrompt(SCENE, CAST);
    expect(system).toMatch(/clothing is never a failure/i);
    expect(system).toMatch(/not a uniform/i);
    expect(system).toMatch(/judge identity by gender, hair, skin/i);
  });

  it('protects scene-named people who are not in the expected cast', () => {
    const { system } = buildQAPrompt(SCENE, CAST);
    expect(system).toMatch(/neither listed nor named in the scene description/i);
    expect(system).toMatch(/missing from the expected list is not an "extra"/i);
  });
});
