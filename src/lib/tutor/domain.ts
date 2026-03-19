// Domain types and skill/item definitions ported from Python

export type Tier = "A" | "B" | "C";

export interface Skill {
  id: string;
  name: string;
  prereqs: string[];
}

export interface Item {
  id: string;
  skillId: string;
  tier: Tier;
  prompt: string;
  answer: string;
  rubric: string;
  meta: Record<string, string>;
}

export interface SkillState {
  skillId: string;
  alpha: number;
  beta: number;
  stability: number;
  robustness: number;
  lastSeen: number | null;
  lastResult: number | null;
  notes: Record<string, unknown>;
}

export function mastery(s: SkillState): number {
  return s.alpha / (s.alpha + s.beta);
}

export function skills(): Skill[] {
  return [
    { id: "claim_evidence", name: "Separate claims from evidence", prereqs: [] },
    { id: "assumptions", name: "Identify hidden assumptions", prereqs: ["claim_evidence"] },
    { id: "counterexample", name: "Find counterexamples", prereqs: ["assumptions"] },
    { id: "causality", name: "Distinguish causation vs correlation", prereqs: ["claim_evidence"] },
    { id: "base_rates", name: "Use base rates in judgment", prereqs: ["claim_evidence"] },
    { id: "necessary_sufficient", name: "Necessary vs sufficient conditions", prereqs: ["claim_evidence"] },
  ];
}

export function defaultSkillState(skillId: string): SkillState {
  return {
    skillId,
    alpha: 1,
    beta: 1,
    stability: 0.35,
    robustness: 0.25,
    lastSeen: null,
    lastResult: null,
    notes: {},
  };
}
