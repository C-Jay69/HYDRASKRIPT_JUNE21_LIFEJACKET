// HydraSkript - Ideas Lab API Route
// POST /api/ideas - Generate structured creative outputs from a raw book idea

import { NextRequest, NextResponse } from 'next/server';
import { askLLMJSONWithFallback } from '@/lib/llm/fallback';
import { isUnauthorizedError, requireProfile, unauthorizedResponse } from '@/lib/api-auth';

// ─── Response Shape Types ──────────────────────────────────────────────────────

interface TitlesResponse {
  titles: { title: string; tagline: string }[];
}

interface OutlineResponse {
  chapters: { number: number; title: string; synopsis: string }[];
}

interface CoverResponse {
  concept: string;
  primaryImage: string;
  mood: string;
  colorPalette: string;
  typography: string;
}

interface BlurbResponse {
  blurb: string;
  tagline: string;
  hook: string;
}

type RequestType = 'titles' | 'outline' | 'cover' | 'blurb';

// ─── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { email } = await requireProfile(request);

    const body = await request.json();
    const { ideaText, genre, targetAudience, requestType } = body as {
      ideaText: string;
      genre: string;
      targetAudience: string;
      requestType: RequestType;
    };

    // ── Validate inputs ────────────────────────────────────────────────────────

    if (!ideaText || typeof ideaText !== 'string' || ideaText.trim().length < 20) {
      return NextResponse.json(
        { success: false, error: 'Idea text must be at least 20 characters.' },
        { status: 400 }
      );
    }

    if (!requestType || !['titles', 'outline', 'cover', 'blurb'].includes(requestType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid requestType. Must be one of: titles, outline, cover, blurb.' },
        { status: 400 }
      );
    }

    const genreLabel = genre || 'general fiction';
    const audienceLabel = targetAudience || 'adult';
    const contextLine = `Genre: ${genreLabel}. Target audience: ${audienceLabel}.`;

    console.log(`[API/ideas] ${requestType} request by ${email} — genre=${genreLabel}, audience=${audienceLabel}`);

    // ── Dispatch to LLM by requestType ────────────────────────────────────────

    let data: TitlesResponse | OutlineResponse | CoverResponse | BlurbResponse;

    switch (requestType) {
      case 'titles': {
        const systemPrompt =
          'You are a bestselling book title expert. ' +
          'Generate 5 compelling, commercially appealing book titles for the given idea. ' +
          'Each title should be memorable, genre-appropriate, and come with a short tagline that sells the story. ' +
          'Return ONLY valid JSON matching: { "titles": [{ "title": string, "tagline": string }] }';

        const userPrompt =
          `${contextLine}\n\nIdea:\n${ideaText.trim()}\n\n` +
          'Generate 5 distinct title options that span different tones (literary, commercial, mysterious, etc.).';

        data = await askLLMJSONWithFallback<TitlesResponse>(systemPrompt, userPrompt, 0.85);
        break;
      }

      case 'outline': {
        const systemPrompt =
          'You are a professional story architect and developmental editor. ' +
          'Create a detailed 10-chapter book outline for the given idea. ' +
          'Each chapter should build naturally on the previous one, maintain narrative momentum, ' +
          'and clearly advance the plot or argument. ' +
          'Return ONLY valid JSON matching: { "chapters": [{ "number": number, "title": string, "synopsis": string }] }. ' +
          'The synopsis for each chapter should be 1-2 sentences describing what happens. ' +
          'CRITICAL: Every chapter MUST have a meaningful, non-empty title. For children\'s books, use simple, engaging titles that young readers can understand and remember.';

        const userPrompt =
          `${contextLine}\n\nIdea:\n${ideaText.trim()}\n\n` +
          'Create a 10-chapter outline with clear narrative arc, compelling chapter titles, and concise synopses.';

        const rawResult = await askLLMJSONWithFallback<OutlineResponse>(systemPrompt, userPrompt, 0.7);

        // Sanitize chapter data: ensure all titles are valid strings
        // LLMs can sometimes return empty/null titles, especially for children's content
        const sanitizedChapters = (rawResult as any)?.chapters?.map((ch: any, idx: number) => ({
          number: ch?.number ?? idx + 1,
          title: typeof ch?.title === 'string' && ch.title.trim().length > 0
            ? ch.title.trim()
            : `Chapter ${idx + 1}`, // Fallback title if original is invalid
          synopsis: typeof ch?.synopsis === 'string' ? ch.synopsis.trim() : '',
        })) ?? [];

        data = { chapters: sanitizedChapters } as OutlineResponse;
        break;
      }

      case 'cover': {
        const systemPrompt =
          'You are an award-winning book cover art director with expertise in commercial publishing. ' +
          'Describe a compelling book cover design concept that will stand out on shelves and online storefronts. ' +
          'Think about iconic imagery, emotional impact, and genre conventions. ' +
          'Return ONLY valid JSON matching: ' +
          '{ "concept": string, "primaryImage": string, "mood": string, "colorPalette": string, "typography": string }. ' +
          '"concept" is the overall vision (2-3 sentences). ' +
          '"primaryImage" is the central visual element description. ' +
          '"mood" is the emotional atmosphere (1 sentence). ' +
          '"colorPalette" lists 3-5 specific colors or color ranges. ' +
          '"typography" describes font style and placement.';

        const userPrompt =
          `${contextLine}\n\nIdea:\n${ideaText.trim()}\n\n` +
          'Design a cover concept that immediately communicates genre, tone, and intrigue.';

        data = await askLLMJSONWithFallback<CoverResponse>(systemPrompt, userPrompt, 0.75);
        break;
      }

      case 'blurb': {
        const systemPrompt =
          'You are a professional book marketing copywriter who specializes in back-cover blurbs. ' +
          'Write compelling marketing copy that hooks readers and drives purchases. ' +
          'A great blurb raises questions without giving away the ending, establishes stakes, ' +
          'and ends with an irresistible call to read. ' +
          'Return ONLY valid JSON matching: { "blurb": string, "tagline": string, "hook": string }. ' +
          '"blurb" is the full back-cover text (3-4 paragraphs). ' +
          '"tagline" is a single punchy line (under 10 words). ' +
          '"hook" is the opening sentence designed to grab attention immediately.';

        const userPrompt =
          `${contextLine}\n\nIdea:\n${ideaText.trim()}\n\n` +
          'Write a compelling back-cover blurb that will make readers unable to put the book down.';

        data = await askLLMJSONWithFallback<BlurbResponse>(systemPrompt, userPrompt, 0.8);
        break;
      }
    }

    console.log(`[API/ideas] ${requestType} generation successful for ${email}`);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/ideas] Request failed:', message, error instanceof Error ? error.stack : '');
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
