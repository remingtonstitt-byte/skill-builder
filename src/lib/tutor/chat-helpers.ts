import { skills, type Item } from "./domain";

function extractNumbers(text: string | null): number[] {
  if (!text) return [];
  const matches = text.match(/\b(1[5-9]\d{2}|20\d{2}|\d+)\b/g) || [];
  return matches.map(Number).filter(n => !isNaN(n));
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "can", "not", "no", "yes",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as", "into", "about", "after",
  "before", "over", "under", "between", "through", "during", "it", "its", "they", "them", "their",
  "you", "your", "we", "our", "i", "me", "my", "he", "she", "his", "her", "which", "what", "who",
  "when", "where", "why", "how", "all", "each", "every", "some", "any", "such", "same", "other",
  "more", "most", "less", "least", "very", "just", "only", "also", "even", "so", "than", "too",
]);

/** Prompt is about recall / geography / simple facts, not claim–evidence style drills. */
function isFactualKnowledgeQuestion(promptL: string): boolean {
  if (/\b(claim|evidence|assumption|assumptions|conclusion|infer|correlation|causation|counterexample|necessary|sufficient|premise|fallacy|label the|classify|which (label|option))\b/.test(promptL)) {
    return false;
  }
  if (/\b(capital of|largest city (in|of)|currency (of|in)|population of|official language|national anthem|how many states in)\b/.test(promptL)) {
    return true;
  }
  if (/\bwho (invented|discovered|wrote|painted|composed|founded)\b/.test(promptL)) {
    return true;
  }
  if (/^what is the (capital|population|currency|formula|name|speed of|distance|value)\b/.test(promptL)) {
    return true;
  }
  if (/\b(in what year was|what year did|when was \w+ (born|founded))\b/.test(promptL)) {
    return true;
  }
  if (/^(what|who|where|when) is\b/.test(promptL) && promptL.length < 100) {
    return true;
  }
  return false;
}

/** Hints for trivia / recall — never state the answer. */
function factualKnowledgeHint(
  item: Item,
  promptL: string,
  lastAnswer: string,
  expected: string,
): string {
  const expectedNums = extractNumbers(expected).length ? extractNumbers(expected) : extractNumbers(item.prompt || "");
  const userNums = extractNumbers(lastAnswer);

  if (expectedNums.length && userNums.length) {
    const target = expectedNums[0];
    const userNum = userNums[0];
    const diff = Math.abs(target - userNum);
    const dir = userNum < target ? "higher" : "lower";
    const rel = diff / Math.max(Math.abs(target), 1);
    if (diff <= 2) return `Your number is **very close**—try nudging slightly **${dir}**.`;
    if (diff <= 15 || rel < 0.08) return `You're in a plausible range—adjust a bit **${dir}** and double-check **units** (years, %, etc.).`;
    if (rel < 0.35) return `The **scale** might be off—re-read which quantity is asked for, then try **${dir}**.`;
    return `Re-read which **exact number** the question wants; your answer may be the wrong **magnitude**.`;
  }
  if (expectedNums.length && lastAnswer && !userNums.length) {
    return `This expects a **number**—give one clear value with the right **units**.`;
  }

  if (/\bcapital of\b/.test(promptL)) {
    return "A **capital** is the city where the country’s **main government** is usually based. Answer with a **city name** (proper noun), not the country itself.";
  }
  if (/\b(where|which country|which continent|which state)\b/.test(promptL) && /\b(is|are|located|situated)\b/.test(promptL)) {
    return "Pin down the **kind of place** asked for (country, city, region)—then the **specific name** at that level.";
  }
  if (/\bwho (is|was|are|were)\b/.test(promptL) || /^who\b/.test(promptL)) {
    return "Give the **person (or role)** the question names—not a paragraph of context.";
  }
  if (/\bwhen\b/.test(promptL) || /\bwhat year\b/.test(promptL)) {
    return "Narrow to a **date, year, or era** the wording points to—check whether it wants **order** or a **single** time.";
  }
  if (/^what (is|are)\b/.test(promptL)) {
    return "Give a **short factual answer**: name, number, or phrase—**only** what was asked, not extra explanation.";
  }
  return "Read the question literally: it wants a **specific fact**—answer in the **shortest form** that fits.";
}

/** Strategy line for critical-thinking skill items — never mentions the correct answer. */
function skillStrategy(skillId: string): string {
  const map: Record<string, string> = {
    claim_evidence:
      "Separate what the text **states outright** from what someone **concludes or infers**.",
    assumptions:
      "Ask: *What has to be true* for this line of reasoning to work—even if nobody said it aloud?",
    counterexample:
      "Try to imagine **one concrete case** where the general claim would break down.",
    causality:
      "Check whether two things **merely happen together** or whether one **actually drives** the other (shared causes?).",
    base_rates:
      "Before trusting a striking number, ask how **common** that outcome is in the **whole relevant population**.",
    necessary_sufficient:
      "Clarify: must this condition hold (**necessary**), or does it **by itself guarantee** the result (**sufficient**)?",
  };
  return map[skillId] || "Break the prompt into smaller claims and test each one against the wording.";
}

function keyTermsFromPrompt(prompt: string, banLower: Set<string>, max = 4): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w) && !banLower.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

function questionShapeHint(promptL: string, skillLine: string): string | null {
  if (promptL.includes("who"))
    return `${skillLine} Think about **roles and relationships** (who is responsible, who is affected)—not jumping to a name too fast.`;
  if (promptL.includes("where"))
    return `${skillLine} Use **place clues** in the setup: region, setting, or system—not a vague “somewhere.”`;
  if (promptL.includes("when"))
    return `${skillLine} Clarify **what kind of time** matters: order of events, duration, or a period implied by context.`;
  if (promptL.includes("why"))
    return `${skillLine} Separate **mechanism or reasoning** from opinion, mood, or a single catchy explanation.`;
  if (promptL.includes("how"))
    return `${skillLine} Sketch **steps or factors** that would produce the outcome instead of a single label.`;
  return null;
}

/**
 * Hints grounded in the **question** (and skill only for thinking drills).
 * Never prints `item.answer` or target numbers/decades.
 */
export function hintFor(item: Item, lastUserAnswer?: string): string {
  const prompt = item.prompt || "";
  const expected = item.answer || "";
  const lastAnswer = (lastUserAnswer || "").trim();
  const promptL = prompt.toLowerCase();

  if (isFactualKnowledgeQuestion(promptL)) {
    return factualKnowledgeHint(item, promptL, lastAnswer, expected);
  }

  const skillLine = skillStrategy(item.skillId);

  const banFromAnswer = new Set<string>();
  const ansLower = expected.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
  for (const w of ansLower) banFromAnswer.add(w);

  const expectedNums = extractNumbers(expected).length ? extractNumbers(expected) : extractNumbers(prompt);
  const userNums = extractNumbers(lastAnswer);

  if (expectedNums.length && userNums.length) {
    const target = expectedNums[0];
    const userNum = userNums[0];
    const diff = Math.abs(target - userNum);
    const dir = userNum < target ? "higher" : "lower";
    const rel = diff / Math.max(Math.abs(target), 1);

    if (diff <= 2)
      return `${skillLine} Your number is **very close**—try nudging it slightly **${dir}**.`;
    if (diff <= 15 || rel < 0.08)
      return `${skillLine} You're in a plausible range—adjust the number a bit **${dir}** and re-check the **units** the question expects.`;
    if (rel < 0.35)
      return `${skillLine} The **order of magnitude** may be off—re-read which quantity is asked for, then try a **${dir}** scale.`;
    return `${skillLine} Re-read what **exact quantity** the prompt wants (count, year, %, rate); your answer may be answering a **different magnitude** than intended.`;
  }

  if (expectedNums.length && lastAnswer && !userNums.length) {
    return `${skillLine} This looks **numeric**—try giving a **single clear number** with the right **units** (years, %, count, etc.).`;
  }

  if (["year", "date", "how many", "percentage", "percent", "rate", "probability"].some(w => promptL.includes(w))) {
    return `${skillLine} Anchor to **what the scenario states**; watch **units** and whether the question wants an **estimate** or an **exact** reading.`;
  }

  const shape = questionShapeHint(promptL, skillLine);
  if (shape) return shape;

  const terms = keyTermsFromPrompt(prompt, banFromAnswer, 4);
  if (terms.length >= 2) {
    return `${skillLine} Notice **${terms[0]}** and **${terms[1]}** in the setup—which part is offered as support, and which part is the conclusion?`;
  }
  if (terms.length === 1) {
    return `${skillLine} Focus on what **${terms[0]}** is doing in the argument—not the wording around it only.`;
  }

  const skillName = skills().find(s => s.id === item.skillId)?.name;
  if (skillName) {
    return `${skillLine} You're practicing **${skillName}**—underline the **exact sentence** you must answer, then apply that lens.`;
  }

  return `${skillLine} Read the question **once for gist**, once **word-by-word**—then answer only what was asked.`;
}

function extractQuestionLines(text: string): string | null {
  const lines = text.split("\n");
  let capture = false;
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim().toLowerCase().startsWith("question:")) capture = true;
    if (capture) out.push(line);
  }
  const result = out.join("\n").trim();
  return result || null;
}

export function rewriteItemPrompt(item: Item, instruction: string): Item {
  if (!instruction) return item;
  const instr = instruction.toLowerCase().trim();
  const prompt = item.prompt || "";

  if (["short", "shorter", "simple", "simpler", "basic", "easy", "easier"].some(k => instr.includes(k))) {
    const q = extractQuestionLines(prompt);
    if (q) return { ...item, prompt: q };
    const trimmed = prompt.trim().split(/\s+/).slice(0, 60).join(" ");
    return { ...item, prompt: trimmed };
  }

  if (instr.includes("step")) {
    const steps = "Step 1: Read the key idea. Step 2: Answer with that key idea.";
    return { ...item, prompt: `${steps}\n\n${prompt}` };
  }

  return item;
}
