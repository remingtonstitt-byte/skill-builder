import { type Item, type SkillState, type Tier, mastery, skills } from "./domain";
import { createRNG, generateItem } from "./generators";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function prerequisites(skillId: string): string[] {
  for (const s of skills()) {
    if (s.id === skillId) return s.prereqs;
  }
  return [];
}

export function tierPolicy(state: SkillState): Tier {
  const m = mastery(state);
  const r = state.robustness;
  if (m < 0.65) return "A";
  if (r < 0.55) return "B";
  return "C";
}

export function selectNext(
  seed: number,
  states: Record<string, SkillState>,
  exploration = 0.35
): { skillId: string; tier: Tier; reason: string } {
  const rng = createRNG(seed);
  const scored: { score: number; sid: string; reason: string }[] = [];

  for (const [sid, st] of Object.entries(states)) {
    const m = mastery(st);
    const weak = 1 - m;
    const prereqIds = prerequisites(sid);
    let prereqGap = 0;
    for (const pid of prereqIds) {
      const pst = states[pid];
      if (pst) prereqGap += Math.max(0, 0.8 - mastery(pst));
    }
    const novelty = st.lastSeen === null ? 0.1 : 0;
    const noise = rng.random() * exploration;
    const score = weak + 0.6 * prereqGap + novelty + noise;
    scored.push({ score, sid, reason: `weak=${weak.toFixed(2)}, prereq_gap=${prereqGap.toFixed(2)}` });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const tier = tierPolicy(states[best.sid]);
  return { skillId: best.sid, tier, reason: best.reason };
}

function tokenize(s: string): string[] {
  return (s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function generalIdeaMatch(userAnswer: string, expected: string, rubric: string): boolean {
  const uaTokens = new Set(tokenize(userAnswer).filter(t => t.length >= 3));
  if (uaTokens.size < 1) return false;
  const refTokens = new Set(tokenize(expected + " " + rubric).filter(t => t.length >= 3));
  let overlap = 0;
  for (const t of uaTokens) {
    if (refTokens.has(t)) overlap++;
  }
  // Accept if at least 1 meaningful token overlaps (was 2, too strict)
  return overlap >= 1;
}

export function judge(item: Item, userAnswer: string): { correct: boolean; feedback: string } {
  const ua = (userAnswer || "").trim().toLowerCase();
  const ans = (item.answer || "").trim().toLowerCase();

  // Empty / give-up answers
  if (!ua || ["idk", "i don't know", "dont know"].includes(ua))
    return { correct: false, feedback: ans ? `Expected: ${item.answer}` : "Try again with more detail." };

  // If expected answer is empty — this is an open-ended question.
  // Don't auto-accept; return incorrect so AI judge handles it upstream.
  if (!ans || ans.startsWith("<")) {
    return { correct: false, feedback: "This question needs a specific answer." };
  }

  // Exact match
  if (ua === ans) return { correct: true, feedback: "Correct!" };

  // Check if user answer contains the expected answer or vice versa
  if (ua.includes(ans) || ans.includes(ua)) return { correct: true, feedback: "Correct!" };

  // Open-ended skills: assumptions, counterexample
  if (item.skillId === "assumptions" || item.skillId === "counterexample") {
    if (ua.length < 5) return { correct: false, feedback: `Too short. Example answer: ${item.answer}` };
    const tokens = new Set(tokenize(item.answer).filter(t => t.length >= 4));
    const overlap = tokenize(userAnswer).filter(t => tokens.has(t)).length;
    if (overlap >= 1) return { correct: true, feedback: "Reasonable!" };
    if (generalIdeaMatch(ua, item.answer, item.rubric)) return { correct: true, feedback: "Correct (general idea)." };
    return { correct: false, feedback: `Example answer: ${item.answer}` };
  }

  // General-idea fallback for any item
  if (ua.length >= 3 && generalIdeaMatch(ua, item.answer, item.rubric)) {
    return { correct: true, feedback: "Correct!" };
  }

  return { correct: false, feedback: `Expected: ${item.answer}` };
}

export function updateModel(
  state: SkillState,
  item: Item,
  correct: boolean,
  confidence: number | null
): SkillState {
  const alpha = state.alpha + (correct ? 1 : 0);
  const beta = state.beta + (correct ? 0 : 1);

  let stability = state.stability;
  let robustness = state.robustness;

  if (correct) {
    stability = clamp01(stability + (item.tier === "A" ? 0.06 : 0.04));
    robustness = clamp01(robustness + (item.tier === "B" || item.tier === "C" ? 0.08 : 0.02));
  } else {
    stability = clamp01(stability - (item.tier === "A" ? 0.10 : 0.07));
    robustness = clamp01(robustness - (item.tier === "B" || item.tier === "C" ? 0.10 : 0.05));
  }

  const notes = { ...state.notes };
  if (confidence !== null) {
    const n = Number(notes.cal_n || 0);
    const err = Number(notes.cal_err || 0);
    const outcome = correct ? 1 : 0;
    const ce = Math.abs(confidence - outcome);
    notes.cal_n = n + 1;
    notes.cal_err = (err * n + ce) / (n + 1);
  }

  const hist = Array.isArray(notes.recent_feedback) ? notes.recent_feedback : [];
  notes.recent_feedback = [...hist, correct ? "✅" : "❌"].slice(-5);

  return {
    ...state,
    alpha,
    beta,
    stability,
    robustness,
    lastSeen: Date.now(),
    lastResult: correct ? 1 : 0,
    notes,
  };
}

export function masteryProof(state: SkillState): boolean {
  return mastery(state) >= 0.85 && state.robustness >= 0.70 && state.stability >= 0.65;
}

export function summarizeState(st: SkillState): string {
  const m = mastery(st);
  const cal = st.notes.cal_err;
  const calS = typeof cal === "number" ? `, cal_err=${cal.toFixed(2)}` : "";
  return `mastery=${m.toFixed(2)}, stability=${st.stability.toFixed(2)}, robustness=${st.robustness.toFixed(2)}${calS}`;
}

export { generateItem, createRNG };
