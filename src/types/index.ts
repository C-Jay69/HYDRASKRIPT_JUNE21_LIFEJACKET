// HydraSkript - Shared TypeScript Interfaces & Types
// All domain types for the book generation platform

// ─── Enums ────────────────────────────────────────────────────────────────────

export type Tier = 'free' | 'starter' | 'author' | 'publisher' | 'studio' | 'founder';
export type CreditPackKey = 'pack_100' | 'pack_500' | 'pack_1000';
export type PricingKey = Exclude<Tier, 'free' | 'founder'> | CreditPackKey;
export type TargetAudience = 'adult' | '0-5' | '6-9' | '10-14';
export type BookStatus = 'draft' | 'generating' | 'completed' | 'failed';
export type ChapterStatus = 'pending' | 'writing' | 'reviewing' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';
export type JobType = 'generate_outline' | 'write_chapter' | 'generate_image' | 'generate_audiobook' | 'export_pdf' | 'finalize_book' | 'editorial_review' | 'import_manuscript';
export type AssetType = 'cover' | 'illustration' | 'coloring_page' | 'audiobook_chapter' | 'audiobook_complete' | 'pdf_export';
export type Genre = 'fiction' | 'non-fiction' | 'fantasy' | 'sci-fi' | 'mystery' | 'romance' | 'horror' | 'children' | 'young-adult' | 'coloring' | 'poetry' | 'self-help' | 'biography' | 'noir' | 'thriller';

export type ColoringTheme = 'mandalas' | 'undersea-creatures' | 'birds' | 'animals-of-the-wild' | 'famous-landmarks' | 'exotic-sports-cars' | 'flowers-gardens' | 'fantasy-dragons' | 'zen-patterns' | 'architectural-details' | 'butterflies-insects' | 'vintage-botanicals';

// ─── Book Generation Types ────────────────────────────────────────────────────

export interface OutlineChapter {
  title: string;
  synopsis: string;
  wordTarget: number;
}

export interface BookOutline {
  title: string;
  chapters: OutlineChapter[];
}

export interface ChapterGenerationResult {
  content: string;
  charactersIntroduced: string[];
  summaryForNextChapter: string;
}

// ─── Style Profile Types ─────────────────────────────────────────────────────

export interface StyleProfileData {
  id: string;
  name: string;
  description: string;
  exemplarTexts: string[];
  systemPrompt: string;
}

// ─── Credit System Types ──────────────────────────────────────────────────────

export interface CreditCostTable {
  chapterPerThousandWords: number;  // 5 credits per 1000 words
  image: number;                    // 10 credits each
  audiobookBase: number;            // 20 credits base
  audiobookPerMinute: number;       // 2 credits per minute
  exportPdf: number;                // 2 credits
  outlineGeneration: number;        // 3 credits
}

export const CREDIT_COSTS: CreditCostTable = {
  chapterPerThousandWords: 5,   // Value-based: 5 credits per 1k words to support steering/edits
  image: 10,                    // Premium: 10 credits for consistency-checked art
  audiobookBase: 20,            // 20 credits base
  audiobookPerMinute: 2,        // 2 credits per minute
  exportPdf: 5,                 // 5 credits for professional POD formatting
  outlineGeneration: 5,         // 5 credits for the Story Blueprint
};

// ─── Target Audience Config ───────────────────────────────────────────────────

export const AUDIENCE_CONFIG: Record<TargetAudience, { maxPages: number; defaultChapters: number; wordsPerChapter: number; illustrationStyle: string }> = {
  'adult':    { maxPages: 600, defaultChapters: 10, wordsPerChapter: 1500, illustrationStyle: 'none' },
  '10-14':    { maxPages: 25,  defaultChapters: 25, wordsPerChapter: 600,  illustrationStyle: 'pixar' },
  '6-9':      { maxPages: 15,  defaultChapters: 15, wordsPerChapter: 350,  illustrationStyle: 'pixar' },
  '0-5':      { maxPages: 8,   defaultChapters: 8,  wordsPerChapter: 80,   illustrationStyle: 'pixar' },
};

// ─── Coloring Book Themes ─────────────────────────────────────────────────────

export const COLORING_THEMES: Record<ColoringTheme, { label: string; description: string; coverPrompt: string; pagePromptPrefix: string; icon: string }> = {
  'mandalas': {
    label: 'Mandalas',
    description: 'Intricate circular patterns for meditative coloring',
    coverPrompt: 'Beautiful mandala coloring book cover, intricate circular sacred geometry patterns, symmetrical design, ornate details',
    pagePromptPrefix: 'Intricate mandala design with',
    icon: '🏵️',
  },
  'undersea-creatures': {
    label: 'Undersea Creatures',
    description: 'Whales, octopuses, seahorses, and coral reefs',
    coverPrompt: 'Undersea creatures coloring book cover, whale, octopus, seahorse, coral reef, underwater ocean scene, detailed line art',
    pagePromptPrefix: 'Detailed undersea creature,', 
    icon: '🐙',
  },
  'birds': {
    label: 'Birds',
    description: 'Exotic birds, songbirds, birds of prey, and tropical parrots',
    coverPrompt: 'Birds coloring book cover, exotic parrots, eagle, hummingbird, detailed feathers, beautiful avian illustrations',
    pagePromptPrefix: 'Detailed bird illustration,',
    icon: '🦅',
  },
  'animals-of-the-wild': {
    label: 'Animals of the Wild',
    description: 'Lions, elephants, wolves, tigers, and majestic wildlife',
    coverPrompt: 'Wild animals coloring book cover, lion, elephant, wolf, tiger, majestic wildlife, detailed fur and features',
    pagePromptPrefix: 'Wild animal in natural habitat,',
    icon: '🦁',
  },
  'famous-landmarks': {
    label: 'Famous Landmarks',
    description: 'Eiffel Tower, Taj Mahal, Pyramids, and world architecture',
    coverPrompt: 'World landmarks coloring book cover, Eiffel Tower, Taj Mahal, Great Pyramids, Colosseum, architectural details',
    pagePromptPrefix: 'Famous world landmark,', 
    icon: '🏛️',
  },
  'exotic-sports-cars': {
    label: 'Exotic Sports Cars',
    description: 'Ferraris, Lamborghinis, Porsches, and supercars',
    coverPrompt: 'Exotic sports cars coloring book cover, Ferrari, Lamborghini, Porsche, sleek automotive design, detailed car illustrations',
    pagePromptPrefix: 'Detailed exotic sports car,',
    icon: '🏎️',
  },
  'flowers-gardens': {
    label: 'Flowers & Gardens',
    description: 'Roses, sunflowers, botanical gardens, and floral arrangements',
    coverPrompt: 'Flowers and gardens coloring book cover, roses, sunflowers, botanical garden, floral arrangements, detailed petals',
    pagePromptPrefix: 'Detailed flower or garden scene,',
    icon: '🌹',
  },
  'fantasy-dragons': {
    label: 'Fantasy & Dragons',
    description: 'Dragons, castles, wizards, and mythical creatures',
    coverPrompt: 'Fantasy dragons coloring book cover, dragon, castle, wizard, mythical creatures, epic fantasy scene, detailed scales',
    pagePromptPrefix: 'Fantasy dragon or mythical creature,',
    icon: '🐉',
  },
  'zen-patterns': {
    label: 'Zen Patterns',
    description: 'Calming abstract patterns, waves, and flowing designs',
    coverPrompt: 'Zen patterns coloring book cover, flowing abstract patterns, calming waves, meditative swirls, peaceful designs',
    pagePromptPrefix: 'Calming zen pattern with,', 
    icon: '☯️',
  },
  'architectural-details': {
    label: 'Architectural Details',
    description: 'Gothic cathedrals, Art Deco, Victorian, and ornate buildings',
    coverPrompt: 'Architectural details coloring book cover, gothic cathedral, art deco, Victorian ornament, ornate building details',
    pagePromptPrefix: 'Detailed architectural element,',
    icon: '🏰',
  },
  'butterflies-insects': {
    label: 'Butterflies & Insects',
    description: 'Butterflies, moths, beetles, and delicate wing patterns',
    coverPrompt: 'Butterflies and insects coloring book cover, monarch butterfly, luna moth, beetle, delicate wing patterns, detailed insects',
    pagePromptPrefix: 'Detailed butterfly or insect with intricate wing patterns,',
    icon: '🦋',
  },
  'vintage-botanicals': {
    label: 'Vintage Botanicals',
    description: 'Classic botanical illustrations, herbs, and scientific plant drawings',
    coverPrompt: 'Vintage botanicals coloring book cover, classic botanical illustration style, herbs, ferns, scientific plant drawings, vintage aesthetic',
    pagePromptPrefix: 'Vintage botanical illustration of,',
    icon: '🌿',
  },
};

// ─── Image Style Config ───────────────────────────────────────────────────────

/**
 * `prompt` is the HEAD of every generated prompt (style first — image models
 * weight the head of a prompt most heavily) and `tail` is repeated at the very
 * END of the prompt. Weak image models attend most to the head, strong ones to
 * the tail; repeating the style anchor on both ends is what stops the scene
 * description from washing the house style out of the result.
 */
export const STYLE_CONFIG: Record<string, { prompt: string; size: string; tail?: string }> = {
  pixar: {
    // Lead style anchor — generateImage places this FIRST in the prompt so the
    // image model anchors on the style before reading the scene description.
    prompt: 'A single frame from a modern Pixar-style 3D animated feature film, stylized 3D character design with rounded appealing proportions, large expressive eyes, soft subsurface-scattering skin and fur, richly detailed environment, vibrant saturated color palette, warm cinematic key light with soft rim lighting, shallow depth of field, high-end physically based render, clean readable storybook composition',
    size: '1344x768',
    // Closing style anchor — repeated last so the scene description cannot
    // dilute the look. Also carries the "no text" guard: image models love to
    // stamp gibberish lettering across a picture-book page.
    tail: 'Pixar-style 3D animated feature film frame, stylized rounded character design, cinematic lighting, vibrant colors. No text, no lettering, no watermark.',
  },
  lineart: {
    prompt: 'Clean black outline line art on white, thick even strokes, simple shapes, large white areas to color. No shading or color.',
    size: '1024x1024',
    tail: 'Black outline line art on white, unshaded, uncolored.',
  },
  'lineart-adult': {
    prompt: 'Intricate black contour line art on white, fine even line weight, ornamental detail, white areas to color. No shading or color.',
    size: '1024x1024',
    tail: 'Black contour line art on white, unshaded, uncolored.',
  },
  watercolor: {
    prompt: 'Delicate watercolor illustration, soft pastel colors, dreamy atmosphere, artistic brush strokes',
    size: '1024x1024',
    tail: 'Watercolor illustration, soft pastel washes, visible paper texture.',
  },
  realistic: {
    prompt: 'Photorealistic style, dramatic lighting, high detail, professional composition',
    size: '1344x768',
    tail: 'Photorealistic photograph, natural lighting, sharp focus.',
  },
  // AI Cover Designer presets
  cyberpunk: {
    prompt: 'Cyberpunk aesthetic, neon-drenched cityscape, high-tech low-life, holographic advertisements, rain-slicked streets, glowing signs, chrome and circuitry, volumetric lighting, Blade Runner atmosphere, cinematic composition, highly detailed',
    size: '1344x768',
  },
  noir: {
    prompt: 'Film noir style, high contrast black and white, dramatic shadows, Venetian blind lighting, smoke and fog, gritty urban atmosphere, chiaroscuro, 1940s detective aesthetic, moody, cinematic, heavy grain',
    size: '1344x768',
  },
  minimalist: {
    prompt: 'Minimalist book cover design, clean negative space, bold typography, simple geometric shapes, limited color palette, modern design, iconic imagery, professional publishing quality',
    size: '1344x768',
  },
};

// ─── Job Progress Types ───────────────────────────────────────────────────────

export interface JobProgress {
  id: string;
  status: JobStatus;
  progressMessage: string;
  progressPercent: number;
  retryCount?: number;
  maxRetries?: number;
  leaseExpiresAt?: string | null;
  lastHeartbeatAt?: string | null;
  result?: Record<string, unknown>;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BookWithChapters {
  id: string;
  title: string;
  genre: string;
  targetAudience: TargetAudience;
  status: BookStatus;
  coverImageUrl: string | null;
  totalCreditsEstimated: number;
  totalCreditsCharged: number;
  chapters: {
    id: string;
    index: number;
    title: string;
    status: ChapterStatus;
    wordCount: number;
    illustrationUrl: string | null;
  }[];
  createdAt: string;
}

// ─── Generation Flavor Text ───────────────────────────────────────────────────
// Contextual flavor text for generation progress, based on genre

export const GENERATION_FLAVOR: Record<string, string[]> = {
  fiction: [
    'The characters are finding their voices...',
    'Plot threads are weaving together...',
    'The story is unfolding beautifully...',
    'Chapters are coming to life...',
  ],
  fantasy: [
    'Dragons are circling the tower...',
    'Ancient spells are being incanted...',
    'The realm is taking shape...',
    'Heroes are gathering for the quest...',
  ],
  'sci-fi': [
    'Starships are charting new courses...',
    'The quantum drive is spinning up...',
    'New worlds are forming from stardust...',
    'The AI is compiling its thoughts...',
  ],
  mystery: [
    'Clues are being carefully placed...',
    'The detective is following leads...',
    'Secrets are lurking in the shadows...',
    'The truth is slowly unraveling...',
  ],
  noir: [
    'Shadows lengthen on rain-slicked streets...',
    'A cigarette burns in the dark...',
    'The dame walked in with trouble in her eyes...',
    'The city keeps its secrets close...',
  ],
  thriller: [
    'The clock is ticking...',
    'Every corner hides a threat...',
    'The hunter becomes the hunted...',
    'The truth is more dangerous than the lie...',
  ],
  children: [
    'Rainbows are painting the sky...',
    'Friendly characters are saying hello...',
    'The adventure is just beginning...',
    'Magic is in the air...',
  ],
  'young-adult': [
    'The stakes are getting higher...',
    'The world is changing around them...',
    'Secrets are coming to light...',
    'The journey of self-discovery continues...',
  ],
  coloring: [
    'Lines are being drawn with care...',
    'Patterns are taking shape...',
    'Clean outlines are appearing...',
    'The canvas is ready for color...',
    'Intricate details are emerging...',
    'Each page awaits your palette...',
  ],
  default: [
    'Words are flowing onto the page...',
    'The creative engine is humming...',
    'Inspiration is striking...',
    'The manuscript is growing...',
  ],
};

// ─── Kids Book Adventure Types ────────────────────────────────────────────────

export const KIDS_ADVENTURES = [
  { value: 'farm',      label: 'On the Farm',     emoji: '🐄' },
  { value: 'school',    label: 'At School',       emoji: '🏫' },
  { value: 'fair',      label: 'At the Fair',     emoji: '🎡' },
  { value: 'boat',      label: 'On a Boat',       emoji: '⛵' },
  { value: 'forest',    label: 'In the Forest',   emoji: '🌲' },
  { value: 'beach',     label: 'At the Beach',    emoji: '🏖️' },
  { value: 'space',     label: 'In Space',        emoji: '🚀' },
  { value: 'zoo',       label: 'At the Zoo',      emoji: '🦁' },
  { value: 'castle',    label: 'In a Castle',     emoji: '🏰' },
  { value: 'city',      label: 'In the City',     emoji: '🌆' },
] as const;

export type KidsAdventure = typeof KIDS_ADVENTURES[number]['value'];

// ─── Job Data Types ───────────────────────────────────────────────────────────

export interface JobData {
  id: string;
  jobType: JobType;
  status: JobStatus;
  progressMessage: string;
  progressPercent: number;
  creditsReserved: number;
  creditsConsumed: number;
  errorMessage: string | null;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ─── Extended JobData for admin list (includes extra DB relations) ──────

export type JobListItem = JobData & {
  book: { id: string; title: string } | null;
  owner: { id: string; email: string; name: string } | null;
};

// ─── Audiobook Voices ─────────────────────────────────────────────────────────

export const AUDIOBOOK_VOICES = [
  { id: 'Aoede',         label: 'Aurora',   gender: 'female' as const, style: 'Warm & Storytelling' },
  { id: 'Iapetus',       label: 'Sage',     gender: 'female' as const, style: 'Clear & Professional' },
  { id: 'Achernar',      label: 'Luna',     gender: 'female' as const, style: 'Soft & Gentle' },
  { id: 'Sulafat',       label: 'Iris',     gender: 'female' as const, style: 'British & Sophisticated' },
  { id: 'Laomedeia',     label: 'Skye',     gender: 'female' as const, style: 'Bright & Lively' },
  { id: 'Charon',        label: 'Atlas',    gender: 'male'   as const, style: 'Informative & Authoritative' },
  { id: 'Zubenelgenubi', label: 'River',    gender: 'male'   as const, style: 'Casual & Warm' },
  { id: 'Orus',          label: 'Orion',    gender: 'male'   as const, style: 'Firm & Dynamic' },
  { id: 'Sadaltager',    label: 'Alistair', gender: 'male'   as const, style: 'Knowledgeable & Classic' },
  { id: 'Fenrir',        label: 'Hunter',   gender: 'male'   as const, style: 'Excitable & Bold' },
] as const;



export const STRIPE_PRICE_ENV_KEYS: Record<PricingKey, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  author: 'STRIPE_PRICE_AUTHOR',
  publisher: 'STRIPE_PRICE_PUBLISHER',
  studio: 'STRIPE_PRICE_STUDIO',
  pack_100: 'STRIPE_PRICE_PACK_100',
  pack_500: 'STRIPE_PRICE_PACK_500',
  pack_1000: 'STRIPE_PRICE_PACK_1000',
};

export const PRICING_CONFIG: Record<PricingKey, {
  key: PricingKey;
  label: string;
  credits: number;
  price: number;
  mode: 'subscription' | 'payment';
  category: 'tier' | 'pack';
}> = {
  starter: {
    key: 'starter',
    label: 'Starter',
    credits: 300,
    price: 29,
    mode: 'subscription',
    category: 'tier',
  },
  author: {
    key: 'author',
    label: 'Author',
    credits: 1000,
    price: 79,
    mode: 'subscription',
    category: 'tier',
  },
  publisher: {
    key: 'publisher',
    label: 'Publisher',
    credits: 3000,
    price: 149,
    mode: 'subscription',
    category: 'tier',
  },
  studio: {
    key: 'studio',
    label: 'Studio',
    credits: 10000,
    price: 299,
    mode: 'subscription',
    category: 'tier',
  },
  pack_100: {
    key: 'pack_100',
    label: '100 Credits',
    credits: 100,
    price: 15,
    mode: 'payment',
    category: 'pack',
  },
  pack_500: {
    key: 'pack_500',
    label: '500 Credits',
    credits: 500,
    price: 60,
    mode: 'payment',
    category: 'pack',
  },
  pack_1000: {
    key: 'pack_1000',
    label: '1 000 Credits',
    credits: 1000,
    price: 100,
    mode: 'payment',
    category: 'pack',
  },
};
