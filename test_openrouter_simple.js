// Simple test to verify OpenRouter with Meta Muse is working
// This uses the built-in fetch from Node.js 22+

async function testOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.log('ERROR: No OPENROUTER_API_KEY found in environment');
    return;
  }

  console.log('Testing OpenRouter with Meta Muse model...');

  try {
    const response = await fetch('https://openrouter.ai/api/v1/images/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/muse-image:4.0',
        prompt: 'A cute cartoon cat wearing sunglasses, 1024x1024',
        width: 1024,
        height: 1024,
        n: 1,
      }),
      signal: AbortSignal.timeout(15000)
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error response:', errorText);
      return;
    }

    const data = await response.json();
    console.log('Success! Received response data');
    console.log('Data keys:', Object.keys(data));

    if (data.data && data.data[0]) {
      console.log('First image base64 length:', data.data[0].base64?.length || 'unknown');
    }

  } catch (error) {
    console.log('Error occurred:', error.message);
    if (error.code === 'ABORT_ERR') {
      console.log('Request timed out');
    }
  }
}

// Run the test
testOpenRouter();