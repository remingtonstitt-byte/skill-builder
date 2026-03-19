// Context-based item generation — extract Q&A from scanned text
import { type Item, type Tier } from "./domain";

function mkContextItem(
  skillId: string, tier: Tier, prompt: string, answer: string, rubric: string, meta: Record<string, string>
): Item {
  const hash = Math.abs(simpleHash(prompt + answer)) % 10_000_000;
  return { id: `context:${skillId}:${tier}:${hash}`, skillId, tier, prompt: prompt.trim(), answer: answer.trim(), rubric: rubric.trim(), meta };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ── Extract labeled Q&A pairs (Q: / Question: / A: / Answer:) ──
function extractLabeledQA(text: string): { question: string; answer: string }[] {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const pairs: { question: string; answer: string }[] = [];
  let currentQ: string | null = null;
  let currentA: string | null = null;

  for (const line of lines) {
    const qMatch = line.match(/^(?:q|question)\s*[:.\-]\s*(.+)/i);
    const aMatch = line.match(/^(?:a|answer)\s*[:.\-]\s*(.+)/i);

    if (qMatch) {
      if (currentQ) {
        pairs.push({ question: currentQ, answer: currentA || "" });
      }
      currentQ = qMatch[1].trim();
      currentA = null;
    } else if (aMatch && currentQ) {
      currentA = aMatch[1].trim();
    }
  }
  if (currentQ) {
    pairs.push({ question: currentQ, answer: currentA || "" });
  }
  return pairs;
}

// ── Extract direct questions (Who/What/When...) ──
function extractDirectQuestions(text: string): string[] {
  const candidates = text.split(/\n+|(?<=[.!?])\s+/).map(l => l.trim()).filter(Boolean);
  const questions: string[] = [];

  for (const line of candidates) {
    if (/^(who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|will|would|should|which|name)\b.{8,}/i.test(line)) {
      const q = line.replace(/[.?!]*$/, '').trim() + '?';
      if (!questions.includes(q)) questions.push(q);
    }
  }
  return questions;
}

// ── Simplify a question: keep first 15 words, clean punctuation ──
function simplifyQuestion(question: string): string {
  const words = question.split(/\s+/);
  if (words.length <= 15) return question;
  return words.slice(0, 15).join(" ") + "…?";
}

function sentences(text: string): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+|\n+/).map(p => p.trim()).filter(Boolean);
  return parts.slice(0, 60);
}

function pickSentence(rng: () => number, text: string): string {
  const sents = sentences(text);
  if (!sents.length) return text.trim();
  return sents[Math.floor(rng() * sents.length)];
}

export function generateContextItem(
  rng: () => number,
  skillId: string,
  tier: Tier,
  contextText: string
): Item {
  const text = contextText.trim();

  if (!text) {
    return mkContextItem(
      skillId, tier,
      "No readable text found in the upload. Try a clearer image or paste text directly.",
      "", "Upload a higher-resolution image with clear text.",
      { context_present: "false" },
    );
  }

  // 1) Try labeled Q&A pairs first (Q: ... / A: ...)
  const labeledPairs = extractLabeledQA(text);
  if (labeledPairs.length > 0) {
    const idx = Math.floor(rng() * labeledPairs.length);
    const pair = labeledPairs[idx];
    const simplified = simplifyQuestion(pair.question);
    const rubric = pair.answer
      ? `Correct answer: ${pair.answer}. Accept equivalent phrasing or synonyms. Reject answers that are factually different.`
      : "Grade based on factual accuracy and relevance to the question.";
    return mkContextItem(skillId, tier,
      simplified,
      pair.answer,
      rubric,
      { snippet: text, qa_source: "labeled", original_question: pair.question });
  }

  // 2) Try direct questions (Who/What/When...)
  const directQs = extractDirectQuestions(text);
  if (directQs.length > 0) {
    const idx = Math.floor(rng() * directQs.length);
    const q = directQs[idx];
    const rubric = `This is a knowledge question extracted from study material. Grade based on factual accuracy. The source context is: "${text.slice(0, 500)}". The student should demonstrate understanding of the material.`;
    return mkContextItem(skillId, tier,
      simplifyQuestion(q),
      "",
      rubric,
      { snippet: text, qa_source: "direct", original_question: q });
  }

  // 3) Fallback: generate a simple question about a text snippet
  const snippet = pickSentence(rng, text);
  const baseRubric = `Evaluate based on the source text: "${snippet}". Accept any answer that demonstrates understanding of the key concept.`;
  const simpleQuestions: (() => Item)[] = [
    () => mkContextItem(skillId, tier,
      `What is the main point of: "${snippet}"`,
      "", `${baseRubric} The student should identify the central idea or claim.`,
      { snippet, qa_source: "generated" }),
    () => mkContextItem(skillId, tier,
      `Is this a claim or a fact: "${snippet}"`,
      "", `${baseRubric} A claim is an arguable opinion; a fact is objectively verifiable. Accept either answer if well-reasoned.`,
      { snippet, qa_source: "generated" }),
    () => mkContextItem(skillId, tier,
      `What is one important thing about: "${snippet}"`,
      "", `${baseRubric} Accept any reasonable observation that shows engagement with the text.`,
      { snippet, qa_source: "generated" }),
  ];

  const idx = Math.floor(rng() * simpleQuestions.length);
  return simpleQuestions[idx]();
}
