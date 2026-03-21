/** Browser speech-to-text — produces plain strings for the API (no audio upload). */

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface STTCapabilities {
  supported: boolean;
  warning: string | null;
}

export function detectSTT(): STTCapabilities {
  if (!getSpeechRecognition()) {
    return { supported: false, warning: "Speech recognition not supported in this browser. Try Chrome or Edge." };
  }
  return { supported: true, warning: null };
}

export interface ListenOptions {
  lang?: string;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

export function startListening(options: ListenOptions): { stop: () => void } {
  const SR = getSpeechRecognition();
  if (!SR) {
    options.onError?.("Speech recognition unavailable.");
    return { stop: () => {} };
  }

  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = options.lang || "en-US";

  let finalBuffer = "";

  rec.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript ?? "";
      if (event.results[i].isFinal) {
        finalBuffer += piece;
      } else {
        interim += piece;
      }
    }
    const preview = (finalBuffer + interim).trim();
    if (preview) options.onInterim?.(preview);
  };

  rec.onerror = (e: SpeechRecognitionErrorEvent) => {
    if (e.error === "aborted") return;
    if (e.error === "no-speech") return;
    options.onError?.(
      e.error === "not-allowed" ? "Microphone permission denied." : e.message || e.error
    );
  };

  rec.onend = () => {
    const text = finalBuffer.trim();
    finalBuffer = "";
    options.onEnd?.();
    if (text) options.onFinal(text);
  };

  try {
    rec.start();
  } catch {
    options.onError?.("Could not start microphone.");
    return { stop: () => {} };
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
