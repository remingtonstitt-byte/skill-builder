const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type ChatTurn = { role: 'user' | 'assistant'; content: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const messages = body.messages as ChatTurn[] | undefined;
    const sessionContext = typeof body.sessionContext === 'string' ? body.sessionContext : '';

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const m of messages) {
      if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
        return new Response(JSON.stringify({ error: 'each message must have role user|assistant and string content' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const apiKey = Deno.env.get('claude');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Claude API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contextBlock = sessionContext.trim()
      ? `\n\n--- Session context (plain text; user may have spoken these words via speech-to-text) ---\n${sessionContext.trim()}\n--- End context ---\n`
      : '';

    const systemPrompt = `You are a warm, concise tutor in **chat help mode** (not formal grading).
${contextBlock}
Rules:
- The user's messages are **exactly** what they typed or what was transcribed from their voice. Treat their wording literally; do not assume they "uploaded" audio to you — you only ever receive text.
- Help with hints, explanations, and reasoning. If a practice question is in context, do **not** give away the final scored answer immediately; use Socratic hints unless they clearly ask for the solution after trying.
- Keep replies focused and readable (short paragraphs). Use **bold** sparingly for key terms.
- Never claim you heard audio; refer to "what you said" or "your message" if needed.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude tutor-chat error:', response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited — please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const text = data.content?.find((c: { type?: string }) => c.type === 'text')?.text?.trim()
      ?? data.content?.[0]?.text?.trim()
      ?? '';

    return new Response(JSON.stringify({ text: text || 'Sorry, I had no reply. Try again.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('tutor-chat error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
