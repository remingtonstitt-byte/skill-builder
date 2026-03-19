import { type Item } from "./domain";

function extractNumbers(text: string | null): number[] {
  if (!text) return [];
  const matches = (text.match(/\b(1[5-9]\d{2}|20\d{2}|\d+)\b/g) || []);
  return matches.map(Number).filter(n => !isNaN(n));
}

export function hintFor(item: Item, lastUserAnswer?: string): string {
  const prompt = item.prompt || "";
  const expected = item.answer || "";
  const lastAnswer = lastUserAnswer || "";

  const expectedNums = extractNumbers(expected).length ? extractNumbers(expected) : extractNumbers(prompt);
  const userNums = extractNumbers(lastAnswer);

  // Numeric hints
  if (expectedNums.length && userNums.length) {
    const expectedNum = expectedNums[0];
    const userNum = userNums[0];
    const diff = Math.abs(expectedNum - userNum);
    const userDir = userNum < expectedNum ? "later" : "earlier";
    const expectedDecade = Math.floor(expectedNum / 10) * 10;

    if (diff <= 2) return `Very close—just a couple more units. Try slightly ${userDir}.`;
    if (diff <= 6) return `Close—within a few units. Try moving ${userDir} toward ${expectedDecade}s.`;
    if (diff <= 15) return `Somewhat close—within about a decade. Try ${userDir} toward ${expectedDecade}s.`;
    const userDecade = Math.floor(userNum / 10) * 10;
    if (userDecade !== expectedDecade) return `Pretty far off. You picked the ${userDecade}s; aim for ${expectedDecade}s.`;
    return `Far off—try a number ${userDir} closer to ${expectedDecade}s.`;
  }

  // Numeric question without numeric answer
  const promptL = prompt.toLowerCase();
  if (["year", "date", "time", "how many", "percentage", "rate"].some(w => promptL.includes(w))) {
    return "This seems like a numeric question—think about typical values or ranges.";
  }

  // Word/concept hints
  if (promptL.includes("who")) return "Hint: consider the most famous person or leader related to this context.";
  if (promptL.includes("where")) return "Hint: think about the most likely location for this event or object.";
  if (promptL.includes("when")) return "Hint: place the event on a historical timeline or period.";
  if (promptL.includes("what") || promptL.includes("which")) return "Hint: focus on key concepts or defining features that match the question.";

  return "Hint: think about what is typical in this context or the most well-known answer.";
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
