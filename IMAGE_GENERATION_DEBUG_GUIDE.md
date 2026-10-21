# Troubleshooting Image Generation for Kids Books

Based on the current state, here are the key points to verify for image generation to work properly:

## 1. Book Configuration
Make sure your book has the correct settings:
- **Target Audience**: Should be '0-5', '6-9', or '10-14' for children's book image generation
- **Genre**: Should be 'children' or 'coloring' for image generation to trigger

## 2. Environment Variables
The following environment variables must be properly set in your Vercel deployment:
- `OPENROUTER_API_KEY` (or `OPEN_ROUTER_API_KEY`)
- `STABILITY_AI_API_KEY` 
- `PRUNA_AI_API_KEY`
- `POLLINATIONS_API_KEY`

## 3. Debugging Steps

After making a new book generation request, check the Vercel logs for these messages:
- `[imageService] generateImage called with: style=pixar, assetType=illustration, bookId=...`
- `[imageService] isChildrenBookIllustration: true` 
- `[imageService] Attempting OpenRouter for children's book image`
- `[imageService] OpenRouter API key present: true`
- `[imageService] Attempting OpenRouter with Meta Muse model for children's book`

## 4. Common Issues

### Issue: Book not recognized as children's book
If you see `[imageService] isChildrenBookIllustration: false`, then:
- Check that target audience is set to '0-5', '6-9', or '10-14'
- Check that genre is 'children' or 'coloring'

### Issue: API key not found
If you see `[imageService] OpenRouter API key present: false`, then:
- Verify the API key is set in Vercel environment variables
- Make sure it's named correctly (`OPENROUTER_API_KEY` or `OPEN_ROUTER_API_KEY`)

## 5. Quick Fix for Testing

If you're testing with a new book, ensure you create it with:
- Target Audience: '0-5', '6-9', or '10-14' 
- Genre: 'children' or 'coloring'

The image generation system is now properly implemented and should work when the book configuration is correct.

## 6. Vercel Environment Setup

To fix the API key issues:

1. Go to your Vercel dashboard
2. Navigate to your project settings
3. Go to Environment Variables
4. Add these variables:
   - `OPENROUTER_API_KEY` with your OpenRouter API key
   - `STABILITY_AI_API_KEY` with your Stability AI API key  
   - `PRUNA_AI_API_KEY` with your Pruna AI API key
   - `POLLINATIONS_API_KEY` with your Pollinations API key

## 7. Troubleshooting Checklist

- [ ] Verify book has target audience set to '0-5', '6-9', or '10-14'
- [ ] Verify book has genre set to 'children' or 'coloring'  
- [ ] Confirm all API keys are set in Vercel environment variables
- [ ] Test API keys work independently
- [ ] Check that OpenRouter model `meta/muse-image:4.0` is valid

## 8. Known Issues

- **OpenRouter 404 Error**: This typically occurs when:
  - The API key is invalid or expired
  - The model `meta/muse-image:4.0` is not accessible
  - The OpenRouter endpoint is temporarily unavailable

- **Timeout Issues**: These can occur when:
  - API responses take too long
  - Network connectivity issues with the image generation services
  - Image generation is computationally intensive

## 9. Next Steps

1. Configure the environment variables in Vercel
2. Test with a new children's book
3. Monitor the Vercel logs for successful image generation messages