# Image Generation Troubleshooting Guide

## How an illustration is actually produced

```
chapter prose
   └─ buildIllustrationBrief()      → scene brief written from the chapter's own text
        └─ generateImage()
             ├─ composeImagePrompt()  → [short style tag] + [scene] + [full style vocabulary]
             ├─ buildNegativePrompt() → "photo, anime, 2D cartoon, text, …"
             └─ backend chain         → Pollinations → OpenRouter → Stability → Pruna
```

Two things decide whether the artwork looks like a Pixar picture book:

1. **The prompt.** A *short* style tag leads, the scene comes immediately
   after it, and the full style vocabulary closes the prompt; a negative
   prompt names every look that competes with it. The scene MUST start within
   roughly the first 300 characters: CLIP-based encoders (Flux, SD3) only read
   about the first 77 tokens, so a long style essay at the head evicts the
   subject and the model draws the style words' default subject instead (that
   is how every page of a dog story shipped with a kitten).
2. **The scene brief.** The brief writer sees the whole chapter (head + tail
   when it has to be trimmed) plus the series cast, must state what every
   character IS ("Biscuit, a fluffy brown puppy" — a name alone tells the
   illustrator nothing), and the fallback picks the chapter's most drawable
   sentences instead of its first two. A brief whose animal contradicts the
   chapter (page says dog, brief says kitten) is rejected by the grounding
   gate in `findBriefContradiction()` before it ever reaches the artist.
3. **The seed.** Every picture is seeded from book + chapter + prompt
   (`deriveImageSeed`). Seeding from the book alone gave every chapter the
   identical seed, so each illustration started from the same latent noise
   and converged on the same subject. If every page shows near-identical art,
   suspect the seed first.
4. **The transport.** With `POLLINATIONS_API_KEY` set, requests go to the
   authenticated `gen.pollinations.ai` API with a Bearer header and spend the
   account's Pollen balance. Without a key they fall back to the anonymous
   legacy endpoint (throttled, watermark not reliably removed). The log line
   `[imageService] Pollinations via …` says which one ran. To see exactly
   what the artist was asked for, read `chapter.illustrationPrompt`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `POLLINATIONS_API_KEY` | Pollinations AI (default first backend) |
| `OPENROUTER_API_KEY` / `OPEN_ROUTER_API_KEY` | OpenRouter Images API |
| `OPENROUTER_IMAGE_MODEL` | Image model on OpenRouter (default `bytedance-seed/seedream-4.5`) |
| `POLLINATIONS_MODEL` | Model on Pollinations (default `flux`) |
| `STABILITY_AI_API_KEY` | Stability AI |
| `PRUNA_AI_API_KEY` | Pruna AI (`p-image`) |
| `IMAGE_BACKEND_ORDER` | Comma-separated backend order, e.g. `openrouter,pollinations,stability,pruna` |

### Choosing a backend order

The default order is `pollinations → openrouter → stability → pruna`.

To put OpenRouter's Seedream 4.5 in front — it follows style and scene
instructions far more literally than Pollinations' flux, which is the quickest
lever on "the art is not really Pixar" — set:

```dotenv
IMAGE_BACKEND_ORDER=openrouter,pollinations,stability,pruna
```

Any backend you do not list is kept at the end of the chain as a fallback, so
this can never leave the pipeline without a backend.

## Quality gates

* **Degenerate-image gate** — a flat grey/white wash is rejected and the seed
  is re-rolled.
* **Colour gate** (Pixar style only) — a frame that comes back grey or washed
  out means the style anchor was ignored. It is rejected and re-rolled with a
  new seed, then handed to the next backend. This is the automated version of
  "not really Pixar".
* **Line-art gate** (coloring pages only) — line density must land in the
  range a real coloring page occupies.

## Troubleshooting specific issues

### OpenRouter timeout (504 Gateway Timeout)
* The OpenRouter service is overloaded or the request is too slow.
* Check the key has quota, and watch the request size — a very long prompt
  makes the model slower.
* The chain falls through to the next backend automatically.

### OpenRouter rejects `negative_prompt`
Not every image model accepts the field. The service detects the rejection,
drops the field and retries the same request, so this is handled without any
configuration.

### OpenRouter rejects the requested size
Some models only accept a fixed set of canvas sizes. The service retries with
the nearest supported size of the same orientation.

### Pruna quality gate failures
Pruna is returning images that don't meet quality standards. Retry logic
handles this automatically. Pruna only applies the line-art conversion to
coloring pages — full-colour illustrations are never converted to outlines.

### Pollinations insufficient balance
Top up at enter.pollinations.ai. The service detects the "insufficient
balance" response and stops burning retries on it.

### The artwork does not match the page
1. Read `chapter.illustrationPrompt` — it stores the exact composed prompt
   (style tag + scene + style vocabulary) that was sent to the backend.
   If the scene in it is wrong, the problem is the brief; if the scene is
   right but the picture is wrong, the problem is the backend/seed.
2. Look for `[Illustration] Using heuristic brief:` in the logs. That means the
   brief LLM call failed or timed out and the fallback was used.
3. Look for `[Illustration] Rejecting brief for …` — the grounding gate caught
   a brief whose animal contradicted the chapter and fell back to the
   chapter's own sentences.
4. The brief is derived from the chapter prose, so a stale illustration means a
   stale chapter — retrying the chapter now also clears the old illustration
   and regenerates it.

### The same wrong subject appears on every page (e.g. a kitten in a dog book)
This was a real production failure with three stacked causes, all fixed:
the seed was derived from the book alone (identical for every chapter), a
401-character style essay sat *before* the scene (outside the ~77-token
window CLIP encoders read, so Flux never saw the scene), and the brief could
name a pet without saying what species it is. If it ever recurs, check in
order: `chapter.illustrationPrompt` (does the scene name the right animal,
in the first ~300 characters?), the `[imageService] Pollinations via …` log
line (authenticated or anonymous?), and `POLLINATIONS_MODEL`.

## Monitoring and debugging

Useful log lines:

```
[imageService] generateImage called with: style=pixar, assetType=illustration, bookId=...
[imageService] Backend order: OpenRouter Images → Pollinations AI → Pruna AI
[imageService] Trying OpenRouter Images
[imageService] OpenRouter Images produced the image
[imageService] color gate reject: saturation 0.041 < 0.15 (image is washed out / greyscale)
[Illustration] Visual brief for "The Kite": Maya stands on a wet street holding the red kite…
```

## Quick checklist

- [ ] Fund the backends you intend to use
- [ ] Add the API keys to the deployment's environment variables
- [ ] Optionally set `IMAGE_BACKEND_ORDER` to pick the preferred backend
- [ ] Redeploy (environment variable changes need a redeploy)
- [ ] Generate a **new** book — existing chapters keep the illustration and the
      prompt they were generated with
