// Browser TTS — ported from Python tts.py using Web Speech API

export interface TTSCapabilities {
  backend: "speechSynthesis" | null;
  warning: string | null;
}

export function detectTTS(): TTSCapabilities {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return { backend: "speechSynthesis", warning: null };
  }
  return { backend: null, warning: "No TTS backend available. Browser does not support SpeechSynthesis." };
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(
  text: string,
  options?: { voice?: string; rate?: number; onEnd?: () => void }
): void {
  const clean = stripMarkdown(text).trim();
  if (!clean) return;

  const caps = detectTTS();
  if (!caps.backend) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = options?.rate ?? 1.0;

  if (options?.voice) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(
      v => v.name.toLowerCase().includes(options.voice!.toLowerCase())
    );
    if (match) utterance.voice = match;
  }

  if (options?.onEnd) {
    utterance.onend = options.onEnd;
  }

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function isSpeaking(): boolean {
  return window.speechSynthesis?.speaking ?? false;
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")  // bold
    .replace(/\*([^*]+)\*/g, "$1")       // italic
    .replace(/!\[.*?\]\(.*?\)/g, "")     // images
    .replace(/[📎📷📊🎉✅❌⏭️👋👇📝]/g, "") // emoji
    .replace(/\n+/g, ". ")
    .trim();
}
