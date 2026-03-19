import { type SkillState, defaultSkillState, skills } from "./domain";

const STORAGE_KEY = "tutor_state";

export interface TutorStore {
  states: Record<string, SkillState>;
  attempts: AttemptRecord[];
  userName: string;
}

export interface AttemptRecord {
  ts: number;
  skillId: string;
  tier: string;
  correct: boolean;
  prompt: string;
  userAnswer: string;
  feedback: string;
}

function defaultStore(): TutorStore {
  const states: Record<string, SkillState> = {};
  for (const s of skills()) {
    states[s.id] = defaultSkillState(s.id);
  }
  return { states, attempts: [], userName: "learner" };
}

export function loadStore(): TutorStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    // Ensure all skills exist
    const store = defaultStore();
    if (parsed.states) {
      for (const [k, v] of Object.entries(parsed.states)) {
        store.states[k] = v as SkillState;
      }
    }
    if (parsed.attempts) store.attempts = parsed.attempts;
    if (parsed.userName) store.userName = parsed.userName;
    return store;
  } catch {
    return defaultStore();
  }
}

export function saveStore(store: TutorStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function resetStore(): TutorStore {
  const store = defaultStore();
  saveStore(store);
  return store;
}
