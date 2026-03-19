const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function isContentFilterError(status: number, body: string): boolean {
  return status === 400 && body.includes('Output blocked by content filtering policy');
}

function buildClaudeRequest(imageBase64: string, mimeType: string, retryMode = false) {
  if (retryMode) {
    return {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1800,
      system: 'You are an OCR assistant for study materials. Transcribe only the main educational document content visible in the image. Ignore all browser UI, tabs, sidebars, inboxes, URLs, profile names, notifications, and unrelated interface text. Return plain text only.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'The image may be a screenshot. Extract only the main study content block the student is reading, such as textbook text, worksheet questions, PDF body text, or class notes. Ignore browser chrome, email lists, tabs, headers, footers, menus, and any personal information. Keep paragraph breaks and numbering. If no study content is readable, respond with exactly NO_TEXT_FOUND.',
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/png',
                data: imageBase64,
              },
            },
          ],
        },
      ],
    };
  }

  return {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2500,
    system: 'You are an educational OCR assistant. Your job is to read academic content from screenshots or photos of study materials. Extract only the study content relevant for quiz generation. Ignore browser chrome, tabs, inboxes, URLs, account names, toolbars, file lists, sidebars, notifications, and any personal or unrelated interface text. Return plain text only.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This image may be a screenshot containing a textbook, worksheet, PDF, or class notes inside a browser or app. Extract only the educational content the student is studying. Ignore navigation, browser UI, email inbox content, website headers, personal info, and unrelated on-screen text. Preserve question numbering and paragraph breaks when present. If no study material is readable, respond with exactly NO_TEXT_FOUND.',
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType || 'image/png',
              data: imageBase64,
            },
          },
        ],
      },
    ],
  };
}

async function callClaude(apiKey: string, imageBase64: string, mimeType: string, retryMode = false) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildClaudeRequest(imageBase64, mimeType, retryMode)),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'imageBase64 is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('claude');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Claude API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let response = await callClaude(apiKey, imageBase64, mimeType || 'image/png', false);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited — please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (isContentFilterError(response.status, errText)) {
        const retryResponse = await callClaude(apiKey, imageBase64, mimeType || 'image/png', true);

        if (!retryResponse.ok) {
          const retryErrText = await retryResponse.text();
          console.error('Claude retry error:', retryResponse.status, retryErrText);

          if (isContentFilterError(retryResponse.status, retryErrText)) {
            return new Response(JSON.stringify({
              extracted_text: null,
              engine: 'claude-sonnet-4',
              warning: 'Claude could not isolate the study material from this screenshot. Try cropping to just the worksheet, textbook page, or notes.',
            }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({ error: 'AI service error', details: retryErrText }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        response = retryResponse;
      } else {
        return new Response(JSON.stringify({ error: 'AI service error', details: errText }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const data = await response.json();
    const extractedText = data.content?.[0]?.text?.trim() || '';
    const hasText = extractedText && extractedText !== 'NO_TEXT_FOUND';

    return new Response(JSON.stringify({
      extracted_text: hasText ? extractedText : null,
      engine: 'claude-sonnet-4',
      warning: hasText ? null : 'No study text could be extracted from this image.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('scan-image error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
