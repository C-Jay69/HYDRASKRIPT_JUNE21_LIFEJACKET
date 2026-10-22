# Image Generation Troubleshooting Guide

## How an illustration is actually produced

```
chapter prose
   └─ buildIllustrationBrief()      → scene brief written from the chapter's own text
        └─ generateImage()
             ├─ composeImagePrompt()  → [style anchor] + [scene] + [style anchor]
             ├─ buildNegativePrompt() → "photo, anime, 2D cartoon, text, …"
             └─ backend chain         → Pollinations → OpenRouter → Stability → Pruna
```

Two things decide whether the artwork looks like a Pixar picture book:

1. **The prompt.** The style anchor is now placed at *both* ends of the prompt
   and a negative prompt names every look that competes with it. A model that
   drifts into a flat 2D cartoon, a photograph or a page of gibberish
   lettering was almost always told what to avoid nowhere.
2. **The scene brief.** The brief writer sees the whole chapter (head + tail
   when it has to be trimmed), and the fallback picks the chapter's most
   drawable sentences instead of its first two. A brief written from the wrong
   part of the story is what "the picture does not match the page" looks like.

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
1. Read `chapter.illustrationPrompt` — it stores the exact scene brief that
   was sent to the artist.
2. Look for `[Illustration] Using heuristic brief:` in the logs. That means the
   brief LLM call failed or timed out and the fallback was used.
3. The brief is derived from the chapter prose, so a stale illustration means a
   stale chapter — retrying the chapter now also clears the old illustration
   and regenerates it.

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
