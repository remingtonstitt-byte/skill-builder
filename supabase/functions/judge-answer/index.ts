const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, userAnswer, rubric } = await req.json();
    if (!question || !userAnswer) {
      return new Response(JSON.stringify({ error: 'question and userAnswer are required' }), {
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

    const rubricSection = rubric
      ? `\nGRADING RUBRIC (use this to evaluate):\n${rubric}\n`
      : '';

    const systemPrompt = `You are a quiz answer judge who uses "wise feedback" (David Yeager's research).

Wise feedback has three components:
1. HIGH STANDARDS — You hold the student to a high bar because you believe in their potential.
2. ASSURANCE — You communicate that you believe the student CAN meet that standard.
3. SPECIFIC GUIDANCE — When wrong, you give concrete, actionable direction to help them get there.

Your tone should be warm but direct. Never be dismissive. Frame mistakes as stepping stones.
${rubricSection}
Given a question and a student's answer, determine if the answer is correct, close (partially correct), or wrong.

Reply with EXACTLY one JSON object, no other text:
{"correct": true/false, "close": true/false, "feedback": "your wise feedback message", "expected": "the correct answer in a few words", "guidance": "if wrong, a specific hint or reasoning step to help them get closer next time"}

Rules:
- "correct" = true if the answer is right or essentially right
- "close" = true if the answer is in the right area but not quite right
- Spelling mistakes should still count as correct if the intent is clear
- Be lenient on phrasing but strict on factual accuracy
- When correct: briefly affirm and explain WHY it's right to reinforce learning
- When close: acknowledge what they got right, then guide them to the full answer
- When wrong: use wise feedback — "I'm asking because I know you can get this. Here's what to think about..." Give them a reasoning path, not just the answer
- The "guidance" field should contain a specific thinking prompt or conceptual hint
- If a rubric is provided, grade strictly against it`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 350,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Question: ${question}\nStudent's answer: ${userAnswer}` }
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', response.status, errText);

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
    const raw = data.content?.[0]?.text?.trim() || '';
    
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return new Response(JSON.stringify({
          correct: !!result.correct,
          close: !!result.close,
          feedback: result.feedback || '',
          expected: result.expected || '',
          guidance: result.guidance || '',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch {
      // fallback
    }

    return new Response(JSON.stringify({
      correct: false,
      close: false,
      feedback: 'Could not evaluate answer. Try again.',
      expected: '',
      guidance: '',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('judge-answer error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
