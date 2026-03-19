import type { Item, Tier } from "./domain";

type RNG = { random(): number; choice<T>(arr: T[]): T };

function mkItem(skillId: string, tier: Tier, prompt: string, answer: string, rubric: string, meta: Record<string, string>): Item {
  const hash = Math.abs(simpleHash(prompt + answer)) % 10_000_000;
  return { id: `${skillId}:${tier}:${hash}`, skillId, tier, prompt: prompt.trim(), answer: answer.trim(), rubric: rubric.trim(), meta };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function createRNG(seed: number): RNG {
  let s = seed;
  const random = () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const choice = <T,>(arr: T[]): T => arr[Math.floor(random() * arr.length)];
  return { random, choice };
}

export function genClaimEvidence(rng: RNG, tier: Tier): Item {
  const statements: [string, string, string][] = [
    ["This drug cures insomnia because 9/10 patients reported better sleep.", "evidence", "Reported better sleep (9/10) is evidence; 'cures insomnia' is the claim."],
    ["The city is unsafe since crime rose 10% last year.", "claim", "The conclusion 'unsafe' is a claim; the 10% rise is evidence."],
    ["Our product is the best: it has a 4.8/5 rating from 3,000 users.", "evidence", "Rating is evidence; 'best' is the claim."],
  ];
  const [s, expect, expl] = rng.choice(statements);
  const prompts: Record<Tier, string> = {
    A: `Label the underlined part as CLAIM or EVIDENCE.\nStatement: ${s}\nAnswer with: claim OR evidence`,
    B: `CLAIM vs EVIDENCE stress test.\nStatement: ${s}\nWhich label fits the support being used? Answer: claim OR evidence`,
    C: `Transfer: In one word, label what the numeric/statistical part is (claim/evidence).\nStatement: ${s}\nAnswer: claim OR evidence`,
  };
  return mkItem("claim_evidence", tier, prompts[tier], expect, `Correct label. ${expl}`, { statement: s, explanation: expl });
}

export function genAssumptions(rng: RNG, tier: Tier): Item {
  const scenarios: [string, string][] = [
    ["We should ban cars downtown; pollution will drop.", "That cars are a major source of downtown pollution."],
    ["She's a great leader because she speaks confidently.", "That confident speaking indicates leadership ability."],
    ["If we add more features, users will be happier.", "That users value more features over simplicity/performance."],
  ];
  const [s, assumption] = rng.choice(scenarios);
  const prompts: Record<Tier, string> = {
    A: `Identify ONE hidden assumption in this argument:\n${s}\nAnswer in one sentence.`,
    B: `Stress test: Give ONE assumption that, if false, breaks the argument.\nArgument: ${s}\nAnswer in one sentence.`,
    C: `Transfer: Write ONE necessary assumption for the conclusion to follow.\nArgument: ${s}\nAnswer in one sentence.`,
  };
  return mkItem("assumptions", tier, prompts[tier], assumption, "Any reasonable hidden assumption that is necessary for the conclusion.", { argument: s, example_answer: assumption });
}

export function genCounterexample(rng: RNG, tier: Tier): Item {
  const rules: [string, string][] = [
    ["All tall people are good at basketball.", "A tall person who is bad at basketball."],
    ["If someone is rich, they are happy.", "A rich person who is unhappy."],
    ["Every algorithm that is fast is correct.", "A fast algorithm that gives wrong results."],
  ];
  const [rule, ce] = rng.choice(rules);
  const prompts: Record<Tier, string> = {
    A: `Provide a counterexample to this claim:\n${rule}\nAnswer in one sentence.`,
    B: `Stress test: Construct a specific counterexample.\nClaim: ${rule}\nAnswer in one sentence.`,
    C: `Transfer: Give a counterexample that shows the claim fails.\nClaim: ${rule}\nAnswer in one sentence.`,
  };
  return mkItem("counterexample", tier, prompts[tier], ce, "Any specific case that violates the universal claim.", { claim: rule, example_answer: ce });
}

export function genCausality(rng: RNG, tier: Tier): Item {
  const pairs: [string, string][] = [
    ["Ice cream sales rise when drowning incidents rise.", "correlation"],
    ["People who carry lighters have more lung cancer.", "correlation"],
    ["Wearing seatbelts reduces fatality risk in crashes.", "causation"],
  ];
  const [statement, label] = rng.choice(pairs);
  const prompts: Record<Tier, string> = {
    A: `Does this statement describe CAUSATION or CORRELATION?\n${statement}\nAnswer: causation OR correlation`,
    B: `Stress test: classify correctly.\n${statement}\nAnswer: causation OR correlation`,
    C: `Transfer: Is the relationship causal or correlational?\n${statement}\nAnswer: causation OR correlation`,
  };
  return mkItem("causality", tier, prompts[tier], label, "Correctly identify whether the statement is causal or merely correlational.", { statement });
}

export function genBaseRates(rng: RNG, tier: Tier): Item {
  const problems: [string, string, string][] = [
    ["A disease affects 1 in 1,000 people. A test is 99% accurate (both sensitivity and specificity). You test positive. Is it more likely you have the disease or not?", "not", "With low base rate, false positives can dominate."],
    ["Only 2% of emails are spam. A filter flags an email as spam with 95% accuracy. Flagged as spam. Is it more likely spam or not?", "spam", "Here base rate is higher; with good accuracy, flagged is more likely spam."],
  ];
  const [core, answer, expl] = rng.choice(problems);
  const prompts: Record<Tier, string> = {
    A: `${core}\nAnswer with one word: disease OR not (for disease), or spam OR not (for spam).`,
    B: `Stress test: base rates matter.\n${core}\nAnswer with one word: spam/disease OR not`,
    C: `Transfer: choose the more likely option.\n${core}\nAnswer with one word: spam/disease OR not`,
  };
  return mkItem("base_rates", tier, prompts[tier], answer, `Correct intuition uses base rates. ${expl}`, { explanation: expl });
}

export function genNecessarySufficient(rng: RNG, tier: Tier): Item {
  const items: [string, string][] = [
    ["Being a square implies being a rectangle.", "sufficient"],
    ["Having oxygen is required for fire.", "necessary"],
    ["Being a mammal implies being warm-blooded (roughly).", "sufficient"],
  ];
  const [stmt, label] = rng.choice(items);
  const prompts: Record<Tier, string> = {
    A: `In this statement, is the condition NECESSARY or SUFFICIENT?\n${stmt}\nAnswer: necessary OR sufficient`,
    B: `Stress test: classify the logical role.\n${stmt}\nAnswer: necessary OR sufficient`,
    C: `Transfer: pick necessary vs sufficient.\n${stmt}\nAnswer: necessary OR sufficient`,
  };
  return mkItem("necessary_sufficient", tier, prompts[tier], label, "Correctly identify the logical role of the condition.", { statement: stmt });
}

type Generator = (rng: RNG, tier: Tier) => Item;

const GENERATORS: Record<string, Generator> = {
  claim_evidence: genClaimEvidence,
  assumptions: genAssumptions,
  counterexample: genCounterexample,
  causality: genCausality,
  base_rates: genBaseRates,
  necessary_sufficient: genNecessarySufficient,
};

export function generateItem(rng: RNG, skillId: string, tier: Tier): Item {
  const gen = GENERATORS[skillId];
  if (gen) return gen(rng, tier);
  return genClaimEvidence(rng, tier);
}
