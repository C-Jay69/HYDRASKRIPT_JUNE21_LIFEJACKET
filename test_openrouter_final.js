// Test to verify OpenRouter configuration works properly
// Based on OpenRouter documentation

async function testOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.log('ERROR: No OPENROUTER_API_KEY found in environment');
    return;
  }

  console.log('Testing OpenRouter configuration...');

  try {
    // First, let's try the correct endpoint and model format
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/muse-image:4.0',
        messages: [
          {
            role: 'user',
            content: 'Hello, test message'
          }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });

    console.log('Chat completions response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Chat completions error:', errorText);
    } else {
      const data = await response.json();
      console.log('Chat completions success!');
    }

  } catch (error) {
    console.log('Chat completions error:', error.message);
  }

  // Now test with the correct image generation endpoint
  try {
    console.log('\nTesting image generation endpoint...');

    const response = await fetch('https://openrouter.ai/api/v1/images/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/muse-image:4.0',
        prompt: 'A cute cartoon cat wearing sunglasses',
        width: 1024,
        height: 1024,
        n: 1,
      }),
      signal: AbortSignal.timeout(15000)
    });

    console.log('Image generation response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Image generation error:', errorText);
    } else {
      const data = await response.json();
      console.log('Image generation success!');
    }

  } catch (error) {
    console.log('Image generation error:', error.message);
  }
}

// Run the test
testOpenRouter();