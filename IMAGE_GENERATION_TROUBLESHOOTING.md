# Image Generation Troubleshooting Guide

## Current Status
Based on the Vercel logs, we can see that:
1. **OpenRouter is timing out** with a 504 Gateway Timeout error
2. **Pruna AI is failing quality gates** repeatedly 
3. **Pollinations has insufficient balance** for image generation

## Recommended Solution

### 1. Fix Your Image Generation Backends

Since you want to prioritize OpenRouter → Pruna → Pollinations, here's what you need to do:

**Step 1: Fund Your Accounts**
- **Pruna AI**: Sign up at pruna.ai and add funds
- **Pollinations**: Top up at enter.pollinations.ai
- **OpenRouter**: Ensure your API key is valid and has sufficient quota

**Step 2: Configure Environment Variables in Vercel**
Go to your Vercel dashboard → Project Settings → Environment Variables and add:
- `OPENROUTER_API_KEY` (your OpenRouter API key)
- `PRUNA_AI_API_KEY` (your Pruna AI API key)  
- `POLLINATIONS_API_KEY` (your Pollinations API key)
- `STABILITY_AI_API_KEY` (your Stability AI API key, optional but recommended)

### 2. Understanding the Priority Order

The updated system now follows this priority:
1. **OpenRouter** (best quality for children's books)
2. **Pruna AI** (cost-effective, fast)
3. **Stability AI** (fallback quality)
4. **Gemini** (Google's model)
5. **Pollinations** (last resort)

### 3. Troubleshooting Specific Issues

#### OpenRouter Timeout (504 Gateway Timeout)
- This suggests the OpenRouter service is temporarily overloaded or your request is taking too long
- Try reducing the complexity of prompts
- Ensure your API key has sufficient quota

#### Pruna Quality Gate Failures
- Pruna is returning images that don't meet quality standards
- This can happen with certain prompts or when the model generates low-quality outputs
- Retry logic should handle this automatically

#### Pollinations Insufficient Balance
- You need to add funds to your Pollinations account
- Visit enter.pollinations.ai to top up your balance

### 4. Testing the Fix

1. After funding your accounts:
   - Restart your Vercel deployment
   - Create a new children's book with genre "children" and audience "0-5"
   - Monitor Vercel logs for successful image generation messages

2. Expected successful log output:
   ```
   [imageService] Attempting OpenRouter for children's book image
   [imageService] Attempting OpenRouter with Meta Muse model for children's book
   [imageService] OpenRouter image generation successful
   ```

### 5. Alternative Approach (If You Want to Skip OpenRouter)

If you want to bypass OpenRouter entirely and use only Pruna and Pollinations:

1. Remove the OpenRouter API key from your Vercel environment variables
2. Or modify the code to skip OpenRouter entirely (but this will reduce quality for children's books)

### 6. Monitoring and Debugging

After implementing fixes, monitor these log messages:
- `[imageService] generateImage called with: style=pixar, assetType=illustration, bookId=...`
- `[imageService] isChildrenBookIllustration: true` 
- `[imageService] Trying OpenRouter as primary backend` (or Pruna/Stability)
- `[imageService] OpenRouter image generation successful` (or Pruna/Stability success)

## Quick Checklist

- [ ] Fund Pruna AI account
- [ ] Fund Pollinations account  
- [ ] Ensure OpenRouter API key is valid
- [ ] Add all API keys to Vercel environment variables
- [ ] Restart Vercel deployment
- [ ] Test with a new children's book