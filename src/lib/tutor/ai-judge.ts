import { supabase } from "@/integrations/supabase/client";

export interface AIJudgeResult {
  correct: boolean;
  close: boolean;
  feedback: string;
  expected: string;
  guidance: string;
}

export async function aiJudge(question: string, userAnswer: string, rubric?: string): Promise<AIJudgeResult> {
  try {
    const { data, error } = await supabase.functions.invoke('judge-answer', {
      body: { question, userAnswer, rubric: rubric || '' },
    });

    if (error) {
      console.error('AI judge error:', error);
      return { correct: false, close: false, feedback: 'Could not evaluate. Try again.', expected: '', guidance: '' };
    }

    return {
      correct: !!data.correct,
      close: !!data.close,
      feedback: data.feedback || '',
      expected: data.expected || '',
      guidance: data.guidance || '',
    };
  } catch (e) {
    console.error('AI judge exception:', e);
    return { correct: false, close: false, feedback: 'Could not evaluate. Try again.', expected: '', guidance: '' };
  }
}

/** Check if an item needs AI judging (context items with no expected answer) */
export function needsAIJudge(item: { answer: string; meta?: Record<string, string> }): boolean {
  const ans = (item.answer || '').trim();
  return !ans || ans.startsWith('<');
}
