import { useState, useCallback, useRef, useEffect, type MutableRefObject } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle, XCircle, Brain, ArrowRight, RotateCcw, BarChart3,
  ImageIcon, X, MessageCircle, Lightbulb, HelpCircle, SkipForward, Send, Volume2, VolumeX,
  Home, LogOut, ScanLine, Upload, Mic,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { type Item, type SkillState, mastery, skills } from "@/lib/tutor/domain";
import { selectNext, judge, updateModel, masteryProof, createRNG, generateItem, summarizeState } from "@/lib/tutor/engine";
import { type TutorStore, type AttemptRecord, loadStore, saveStore, resetStore } from "@/lib/tutor/store";
import { type ImageScanResult, scanImage } from "@/lib/tutor/image-scan";
import { hintFor, rewriteItemPrompt } from "@/lib/tutor/chat-helpers";
import { generateContextItem } from "@/lib/tutor/context-items";
import { speak, stopSpeaking, detectTTS } from "@/lib/tutor/tts";
import { detectSTT, startListening } from "@/lib/tutor/stt";
import { tutorChat, type TutorChatTurn } from "@/lib/tutor/tutor-chat";
import { aiJudge, needsAIJudge } from "@/lib/tutor/ai-judge";

type View = "home" | "session" | "chat" | "report" | "scan";

// ── Session types ──
interface SessionState {
  currentItem: Item | null;
  itemIndex: number;
  totalItems: number;
  feedback: { correct: boolean; text: string } | null;
  skillId: string;
  tier: string;
  reason: string;
  missedItems: { item: Item; skillId: string; tier: string }[];
  reviewingMissed: boolean;
}

function getContextChunk(text: string, index: number): string {
  const parts = (text || "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) return text;

  const chunkSize = 3;
  const start = (index * chunkSize) % parts.length;
  const chunk: string[] = [];
  for (let i = 0; i < Math.min(chunkSize, parts.length); i++) {
    chunk.push(parts[(start + i) % parts.length]);
  }
  return chunk.join(" ");
}

function getQuizPromptText(prompt: string): string {
  const lines = (prompt || "").split(/\n+/).map(line => line.trim()).filter(Boolean);
  const cleanedLines = lines.filter(line => {
    if (/^context \(from your upload\):/i.test(line)) return false;
    if (/^read this:?$/i.test(line)) return false;
    if (/^answer in one short phrase\.?$/i.test(line)) return false;
    if (/^["“']?\d+[.)]?[”"']?$/i.test(line)) return false;
    return true;
  });

  const explicitQuestion = cleanedLines.find(line => /^question:/i.test(line));
  const directQuestion = cleanedLines.find(line => /^(who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|will|would|should|name)\b/i.test(line));
  const chosen = explicitQuestion ?? directQuestion ?? cleanedLines[cleanedLines.length - 1] ?? prompt.trim();

  return chosen
    .replace(/^question:\s*/i, "")
    .replace(/\s*answer:\s*.+$/i, "")
    .trim();
}

// ── Chat types ──
interface ChatMessage {
  id: number;
  role: "tutor" | "user";
  text: string;
  type?: "info" | "correct" | "incorrect" | "hint" | "report" | "mastery";
  /** Set when the user spoke via mic — STT text is what was sent (not audio). */
  viaVoice?: boolean;
}

const CHAT_MODE_INTRO =
  "💬 **Chat Mode** — real back-and-forth with the AI tutor (not graded).\n\nAsk anything in your own words — typed or via the **mic** (your speech is turned into **text** on your device; only that text is sent).\n\nType **quiz** for a practice question. Use **Home → Start Quiz** for graded practice.\n\n📎 Upload an image or type **context: your text** to ground the chat.";

const HOME_CLAUDE_INTRO =
  "**Claude tutor** — ask anything below. Replies come from your Supabase Edge Function `tutor-chat` (plain text only; no audio sent to the server).\n\nThis is the **same conversation** as **Chat Mode**. Scanning an image on Home adds context for both quiz and chat.";

export default function TutorApp() {
  const [view, setView] = useState<View>("home");
  const [store, setStore] = useState<TutorStore>(loadStore);
  const [session, setSession] = useState<SessionState | null>(null);
  const [answer, setAnswer] = useState("");
  const [seedCounter, setSeedCounter] = useState(1);
  const [contextText, setContextText] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  /** Shared Claude API thread (home + chat mode). */
  const claudeTurnsRef = useRef<TutorChatTurn[]>([]);

  const persist = useCallback((s: TutorStore) => {
    setStore(s);
    saveStore(s);
  }, []);

  const startSession = useCallback((numItems = 12) => {
    const s = loadStore();
    const seed = Date.now();
    setSeedCounter(seed);
    const rng = createRNG(seed);
    const { skillId, tier, reason } = selectNext(seed, s.states);
    const sourceText = contextText ? getContextChunk(contextText, 0) : null;
    let item = sourceText
      ? generateContextItem(() => rng.random(), skillId, tier, sourceText)
      : generateItem(rng, skillId, tier);
    if (rewriteInstruction) item = rewriteItemPrompt(item, rewriteInstruction);
    setSession({
      currentItem: item, itemIndex: 0, totalItems: numItems,
      feedback: null, skillId, tier, reason,
      missedItems: [], reviewingMissed: false,
    });
    setAnswer("");
    setView("session");
  }, [contextText, rewriteInstruction]);

  const [judging, setJudging] = useState(false);

  const advanceToNext = useCallback((currentSession: SessionState) => {
    const nextIdx = currentSession.itemIndex + 1;
    if (nextIdx < currentSession.totalItems) {
      const newSeed = seedCounter + nextIdx;
      const rng = createRNG(newSeed);
      const { skillId, tier, reason } = selectNext(newSeed, store.states);
      const sourceText = contextText ? getContextChunk(contextText, nextIdx) : null;
      let item = sourceText
        ? generateContextItem(() => rng.random(), skillId, tier, sourceText)
        : generateItem(rng, skillId, tier);
      if (rewriteInstruction) item = rewriteItemPrompt(item, rewriteInstruction);
      setSession({
        currentItem: item, itemIndex: nextIdx, totalItems: currentSession.totalItems,
        feedback: null, skillId, tier, reason,
        missedItems: [], reviewingMissed: false,
      });
      setAnswer("");
      return;
    }
    // All done
    setSession(null);
    setView("report");
  }, [seedCounter, store.states, contextText, rewriteInstruction]);

  const submitAnswer = useCallback(async () => {
    if (!session?.currentItem || judging) return;
    const item = session.currentItem;

    let result: { correct: boolean; feedback: string };

    if (needsAIJudge(item)) {
      setJudging(true);
      const aiResult = await aiJudge(item.prompt, answer, item.rubric);
      setJudging(false);
      if (aiResult.correct) {
        result = { correct: true, feedback: aiResult.feedback || "Correct!" };
      } else if (aiResult.close) {
        const parts = [`Close! ${aiResult.feedback}`];
        if (aiResult.expected) parts.push(`The answer is: ${aiResult.expected}`);
        if (aiResult.guidance) parts.push(`💡 ${aiResult.guidance}`);
        result = { correct: false, feedback: parts.join("\n") };
      } else {
        const parts = [aiResult.feedback];
        if (aiResult.expected) parts.push(`The answer is: ${aiResult.expected}`);
        if (aiResult.guidance) parts.push(`💡 ${aiResult.guidance}`);
        result = { correct: false, feedback: parts.join("\n") };
      }
    } else {
      result = judge(item, answer);
    }

    const updatedState = updateModel(store.states[session.skillId], item, result.correct, null);
    const attempt: AttemptRecord = {
      ts: Date.now(), skillId: session.skillId, tier: session.tier,
      correct: result.correct, prompt: item.prompt,
      userAnswer: answer, feedback: result.feedback,
    };
    const newStore: TutorStore = {
      ...store,
      states: { ...store.states, [session.skillId]: updatedState },
      attempts: [...store.attempts, attempt],
    };
    persist(newStore);

    if (result.correct) {
      setSession({ ...session, feedback: { correct: true, text: result.feedback } });
      setAnswer("");
      window.setTimeout(() => advanceToNext(session), 800);
    } else {
      setSession({ ...session, feedback: { correct: false, text: result.feedback } });
      setAnswer("");
    }
  }, [session, answer, store, persist, judging, advanceToNext]);

  const handleReset = useCallback(() => {
    const s = resetStore();
    setStore(s);
    setSession(null);
    setView("home");
  }, []);

  if (view === "home") {
    return (
      <HomeView
        onStart={startSession}
        onChat={() => setView("chat")}
        onReport={() => setView("report")}
        onReset={handleReset}
        onScan={() => setView("scan")}
        hasContext={!!contextText}
        contextText={contextText}
        rewriteInstruction={rewriteInstruction}
        onRewriteChange={setRewriteInstruction}
        ttsEnabled={ttsEnabled}
        onTtsEnabledChange={setTtsEnabled}
        claudeTurnsRef={claudeTurnsRef}
      />
    );
  }

  if (view === "scan") {
    return (
      <ScanView
        onBack={() => setView("home")}
        onScanned={(text) => { setContextText(text); setView("home"); }}
        contextText={contextText}
        onClearContext={() => setContextText(null)}
      />
    );
  }

  if (view === "session" && session) {
    return (
      <SessionView
        session={session} answer={answer} setAnswer={setAnswer}
        onSubmit={submitAnswer}
        onQuit={() => setView("report")} store={store}
        judging={judging}
      />
    );
  }

  if (view === "chat") {
    return (
      <ChatView
        store={store}
        persist={persist}
        onBack={() => setView("home")}
        onReport={() => setView("report")}
        rewriteInstruction={rewriteInstruction}
        onRewriteChange={setRewriteInstruction}
        ttsEnabled={ttsEnabled}
        onTtsEnabledChange={setTtsEnabled}
        appContextText={contextText}
        setAppContextText={setContextText}
        claudeTurnsRef={claudeTurnsRef}
      />
    );
  }

  return <ReportView store={store} onBack={() => setView("home")} onStartSession={startSession} />;
}

// ── Home ──
function HomeView({ onStart, onChat, onReport, onReset, onScan, hasContext, contextText, rewriteInstruction, onRewriteChange, ttsEnabled, onTtsEnabledChange, claudeTurnsRef }: {
  onStart: (n?: number) => void;
  onChat: () => void;
  onReport: () => void;
  onReset: () => void;
  onScan: () => void;
  hasContext: boolean;
  contextText: string | null;
  rewriteInstruction: string;
  onRewriteChange: (v: string) => void;
  ttsEnabled: boolean;
  onTtsEnabledChange: (enabled: boolean) => void;
  claudeTurnsRef: MutableRefObject<TutorChatTurn[]>;
}) {
  const { user, isGuest, signOut } = useAuth();
  const [showOcr, setShowOcr] = useState(false);
  const ttsAvailable = detectTTS().backend !== null;
  const sttHome = detectSTT().supported;

  const homeBootstrap = (() => {
    const turns = claudeTurnsRef.current;
    if (turns.length === 0) {
      return {
        lines: [{ id: 1, role: "tutor" as const, text: HOME_CLAUDE_INTRO }],
        nextId: 1,
      };
    }
    let id = 0;
    const lines = turns.map(t => ({
      id: ++id,
      role: t.role === "user" ? ("user" as const) : ("tutor" as const),
      text: t.content,
    }));
    return { lines, nextId: id };
  })();
  const [homeAiLines, setHomeAiLines] = useState(homeBootstrap.lines);
  const [homeAiInput, setHomeAiInput] = useState("");
  const [homeAiBusy, setHomeAiBusy] = useState(false);
  const [homeListening, setHomeListening] = useState(false);
  const homeLineIdRef = useRef(homeBootstrap.nextId);
  const homeListenStopRef = useRef<(() => void) | null>(null);
  const homeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    homeScrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [homeAiLines]);

  const homeSessionContext = useCallback(() => {
    if (!contextText?.trim()) return "";
    return `[Material from your scan or paste — plain text, not audio]\n${contextText.trim().slice(0, 12000)}`;
  }, [contextText]);

  const pushHomeLine = useCallback((role: "user" | "tutor", text: string) => {
    const id = ++homeLineIdRef.current;
    setHomeAiLines(prev => [...prev, { id, role, text }]);
  }, []);

  const sendHomeClaude = useCallback(
    async (raw: string) => {
      const t = raw.trim();
      if (!t || homeAiBusy) return;
      setHomeAiInput("");
      pushHomeLine("user", t);
      claudeTurnsRef.current = [...claudeTurnsRef.current, { role: "user", content: t }];
      setHomeAiBusy(true);
      const result = await tutorChat(claudeTurnsRef.current.slice(-24), homeSessionContext());
      setHomeAiBusy(false);
      if (result.error) {
        claudeTurnsRef.current = claudeTurnsRef.current.slice(0, -1);
        pushHomeLine(
          "tutor",
          `⚠️ ${result.error} If this persists, deploy the Edge Function: \`supabase functions deploy tutor-chat\` and set the \`claude\` secret in Supabase.`
        );
        return;
      }
      claudeTurnsRef.current = [...claudeTurnsRef.current, { role: "assistant", content: result.text }];
      pushHomeLine("tutor", result.text);
      if (ttsEnabled && detectTTS().backend) speak(result.text);
    },
    [homeAiBusy, homeSessionContext, pushHomeLine, claudeTurnsRef, ttsEnabled]
  );

  const toggleHomeMic = useCallback(() => {
    if (homeAiBusy) return;
    if (homeListening) {
      homeListenStopRef.current?.();
      homeListenStopRef.current = null;
      setHomeListening(false);
      return;
    }
    setHomeListening(true);
    const { stop } = startListening({
      onFinal: (spoken) => {
        homeListenStopRef.current = null;
        setHomeListening(false);
        if (spoken.trim()) void sendHomeClaude(spoken.trim());
      },
      onError: () => {
        homeListenStopRef.current = null;
        setHomeListening(false);
      },
      onEnd: () => {
        homeListenStopRef.current = null;
        setHomeListening(false);
      },
    });
    homeListenStopRef.current = stop;
  }, [homeAiBusy, homeListening, sendHomeClaude]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6">
      <h1 className="text-3xl font-bold text-foreground text-center">Adaptive Stress Tutor</h1>

      <Card className="w-full max-w-md border-primary/25 shadow-sm">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="w-5 h-5 text-primary shrink-0" />
            Claude on this page
          </CardTitle>
          <p className="text-xs text-muted-foreground font-normal leading-relaxed">
            Type below and press send — your message goes to the <span className="font-mono text-[10px]">tutor-chat</span> Edge
            Function as plain text (no audio upload). This is the <strong>same conversation</strong> as Chat Mode.
            {contextText ? " Scanned text is included as context." : ""}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <ScrollArea className="h-52 rounded-md border border-border bg-muted/30 p-3">
            <div className="space-y-2 text-sm pr-2">
              {homeAiLines.map(line => (
                <div
                  key={line.id}
                  className={
                    line.role === "user"
                      ? "rounded-lg bg-primary/15 px-3 py-2 text-foreground"
                      : "rounded-lg border border-border/80 bg-card px-3 py-2 text-foreground"
                  }
                >
                  {line.role === "user" ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">You</span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Claude</span>
                  )}
                  <div className={line.role === "user" ? "mt-1 whitespace-pre-wrap" : "mt-1 whitespace-pre-wrap"}>
                    {line.role === "tutor" ? <SimpleMarkdown text={line.text} /> : line.text}
                  </div>
                </div>
              ))}
              <div ref={homeScrollRef} />
            </div>
          </ScrollArea>
          <div className="flex gap-2">
            <Input
              placeholder={contextText ? "Ask about your material…" : "Ask the tutor anything…"}
              value={homeAiInput}
              onChange={e => setHomeAiInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && void sendHomeClaude(homeAiInput)}
              disabled={homeAiBusy}
              className="h-10 flex-1"
            />
            {sttHome && (
              <Button
                type="button"
                variant={homeListening ? "default" : "outline"}
                size="icon"
                className="h-10 w-10 shrink-0"
                disabled={homeAiBusy}
                onClick={toggleHomeMic}
                title={homeListening ? "Stop" : "Speak"}
              >
                <Mic className="w-4 h-4" />
              </Button>
            )}
            <Button
              type="button"
              className="h-10 px-4 shrink-0"
              disabled={!homeAiInput.trim() || homeAiBusy}
              onClick={() => void sendHomeClaude(homeAiInput)}
            >
              {homeAiBusy ? <span className="text-xs">…</span> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onChat}>
              Open full Chat Mode
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`h-8 gap-1.5 text-xs ${ttsEnabled && ttsAvailable ? "border-primary/50 text-primary" : ""}`}
              disabled={!ttsAvailable}
              title={
                ttsAvailable
                  ? "Read tutor replies aloud in the browser"
                  : "Read-aloud needs speech synthesis (try Chrome or Edge on desktop)."
              }
              onClick={() => {
                if (!ttsAvailable) return;
                if (ttsEnabled) stopSpeaking();
                onTtsEnabledChange(!ttsEnabled);
              }}
            >
              {ttsEnabled && ttsAvailable ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              Tutor voice
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasContext && (
        <div className="w-full max-w-md space-y-2">
          <p className="text-sm text-primary">📎 Quiz is based on your scanned upload.</p>
          <button
            onClick={() => setShowOcr(!showOcr)}
            className="text-xs text-muted-foreground underline cursor-pointer"
          >
            {showOcr ? "Hide" : "Show"} scanned text (OCR)
          </button>
          {showOcr && contextText && (
            <div className="text-xs text-foreground bg-muted/50 border border-border rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
              {contextText.slice(0, 1200)}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 w-full max-w-md">
        <Button onClick={onScan} variant="outline" className="h-12 text-lg" size="lg">
          <ImageIcon className="w-5 h-5 mr-2" /> Scan Image
        </Button>
        <Button onClick={() => onStart(12)} className="h-12 text-lg" size="lg">
          Start Quiz
        </Button>
        <Button onClick={onChat} variant="outline" className="h-12 text-lg" size="lg">
          Chat Mode
        </Button>
        <Button
          variant="outline"
          className={`h-12 text-lg gap-2 ${ttsEnabled && ttsAvailable ? "border-primary/50 text-primary" : ""}`}
          disabled={!ttsAvailable}
          title={
            ttsAvailable
              ? "Read tutor replies aloud in the browser"
              : "Read-aloud needs speech synthesis (try Chrome or Edge on desktop)."
          }
          onClick={() => {
            if (!ttsAvailable) return;
            if (ttsEnabled) stopSpeaking();
            onTtsEnabledChange(!ttsEnabled);
          }}
        >
          {ttsEnabled && ttsAvailable ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          {ttsEnabled && ttsAvailable ? "Tutor Voice On" : "Tutor Voice Off"}
        </Button>

        <Button onClick={onReport} variant="outline" className="h-10">
          Report
        </Button>
        <Button onClick={onReset} variant="outline" className="h-10 text-destructive hover:text-destructive">
          Reset
        </Button>
      </div>

      {(user || isGuest) && (
        <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          <div className="text-center sm:text-left">
            <span className="text-sm text-muted-foreground">{user?.email ?? "Guest"}</span>
            {isGuest && !user && (
              <p className="text-xs text-muted-foreground/90 max-w-xs">
                No account on this device — tutor features work; nothing is tied to a login.
              </p>
            )}
          </div>
          <Button onClick={signOut} variant="ghost" size="sm" className="text-muted-foreground shrink-0">
            <LogOut className="w-3 h-3 mr-1" /> {isGuest && !user ? "Leave" : "Sign out"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Scan View ──
function ScanView({ onBack, onScanned, contextText, onClearContext }: {
  onBack: () => void;
  onScanned: (text: string) => void;
  contextText: string | null;
  onClearContext: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload a PNG, JPG, or WebP image.");
      return;
    }

    setError(null);
    setMessage(null);
    setScanning(true);

    const result = await scanImage(file);

    setScanning(false);

    if (result.ocrText && result.ocrText.trim()) {
      setMessage("Image scanned! The AI will quiz you on this content. Go back to start the quiz.");
      onScanned(result.ocrText.trim());
    } else {
      setError(result.warning || "No text found in the image. Try a clearer or higher-resolution image.");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <Button onClick={onBack} variant="outline" size="sm">
          <Home className="w-3 h-3 mr-1" /> Home
        </Button>

        <h2 className="text-2xl font-bold text-foreground">Scan Image</h2>
        <p className="text-muted-foreground">
          Upload an image with text. The AI will extract the content and generate quiz questions from it.
        </p>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleUpload}
            className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
          />

          {scanning && <p className="text-sm text-muted-foreground animate-pulse">Scanning image…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-primary">{message}</p>}
        </div>

        {contextText && (
          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Current Context</p>
            <p className="text-sm text-foreground">
              {contextText.slice(0, 300)}{contextText.length > 300 ? "…" : ""}
            </p>
            <Button onClick={onClearContext} variant="outline" size="sm" className="text-destructive">
              Clear Context
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat View ──
function ChatView({ store, persist, onBack, onReport, rewriteInstruction, onRewriteChange, ttsEnabled, onTtsEnabledChange, appContextText, setAppContextText, claudeTurnsRef }: {
  store: TutorStore;
  persist: (s: TutorStore) => void;
  onBack: () => void;
  onReport: () => void;
  rewriteInstruction: string;
  onRewriteChange: (v: string) => void;
  ttsEnabled: boolean;
  onTtsEnabledChange: (enabled: boolean) => void;
  appContextText: string | null;
  setAppContextText: (v: string | null) => void;
  claudeTurnsRef: MutableRefObject<TutorChatTurn[]>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingItem, setPendingItem] = useState<Item | null>(null);
  const [lastReason, setLastReason] = useState("");
  const [lastSkill, setLastSkill] = useState("");
  const [seedRef] = useState(() => Date.now());
  const seedCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ttsAvailable = detectTTS().backend !== null;
  const sttAvailable = detectSTT().supported;
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);
  const [chatting, setChatting] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const listenStopRef = useRef<(() => void) | null>(null);

  const addMsg = useCallback(
    (role: "tutor" | "user", text: string, type?: ChatMessage["type"], opts?: { viaVoice?: boolean }) => {
      const id = ++msgId.current;
      setMessages(prev => [...prev, { id, role, text, type, viaVoice: opts?.viaVoice }]);
      if (role === "tutor" && ttsEnabledRef.current) {
        speak(text);
      }
    },
    []
  );

  const buildSessionContext = useCallback(() => {
    const parts: string[] = [];
    if (appContextText?.trim()) {
      parts.push(
        `[Material the student is working from — plain text from scan or paste, not an audio file]\n${appContextText.trim().slice(0, 12000)}`
      );
    }
    if (pendingItem) {
      const skillName = skills().find(s => s.id === pendingItem.skillId)?.name || pendingItem.skillId;
      parts.push(
        `[Ungraded practice question — skill: ${skillName}, tier ${pendingItem.tier}]\n${pendingItem.prompt}`
      );
    }
    return parts.join("\n\n");
  }, [appContextText, pendingItem]);

  const sendToClaude = useCallback(
    async (userText: string, voiceOpts?: { viaVoice?: boolean }) => {
      addMsg("user", userText, undefined, { viaVoice: voiceOpts?.viaVoice });
      setChatting(true);
      claudeTurnsRef.current = [...claudeTurnsRef.current, { role: "user", content: userText }];
      const payload = claudeTurnsRef.current.slice(-24);
      const result = await tutorChat(payload, buildSessionContext());
      setChatting(false);
      if (result.error) {
        addMsg("tutor", `⚠️ ${result.error}`, "hint");
        claudeTurnsRef.current = claudeTurnsRef.current.slice(0, -1);
        return;
      }
      claudeTurnsRef.current = [...claudeTurnsRef.current, { role: "assistant", content: result.text }];
      addMsg("tutor", result.text, "info");
    },
    [addMsg, buildSessionContext]
  );

  const askNext = useCallback((ctxOverride?: string | null) => {
    const currentStore = loadStore();
    seedCounterRef.current++;
    const seed = seedRef + seedCounterRef.current;
    const rng = createRNG(seed);
    const { skillId, tier, reason } = selectNext(seed, currentStore.states);

    const ctx = ctxOverride !== undefined ? ctxOverride : appContextText;
    let item: Item;
    if (ctx) {
      item = generateContextItem(() => rng.random(), skillId, tier, ctx);
    } else {
      item = generateItem(rng, skillId, tier);
    }

    setPendingItem(item);
    setLastReason(reason);
    setLastSkill(skillId);
    const skillName = skills().find(s => s.id === skillId)?.name || skillId;
    const ctxBadge = ctx ? " 📎" : "";
    addMsg("tutor", `**${skillName}** · Tier ${tier}${ctxBadge}\n\n${item.prompt}`, "info");
  }, [seedRef, addMsg, appContextText]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addMsg("tutor", `📷 Scanning **${file.name}**…`, "info");
    const result = await scanImage(file);
    if (result.ocrText) {
      claudeTurnsRef.current = [];
      setAppContextText(result.ocrText);
      addMsg("tutor", `✅ OCR extracted text. Future questions will use your upload as context.\n\n> "${result.ocrText.slice(0, 200)}${result.ocrText.length > 200 ? "…" : ""}"`, "info");
      addMsg("tutor", "Generating a context-based question now! 👇", "info");
      setTimeout(() => askNext(result.ocrText), 200);
    } else {
      addMsg("tutor", `Image scanned: **${result.format}** ${result.width}×${result.height}. No OCR text found — you can paste text with the **context:** prefix instead.`, "hint");
      if (result.dataUrl) {
        addMsg("tutor", `![uploaded](${result.dataUrl})`, "info");
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [addMsg, askNext, setAppContextText, claudeTurnsRef]);

  const chatHydratedRef = useRef(false);
  useEffect(() => {
    if (chatHydratedRef.current) return;
    chatHydratedRef.current = true;
    const turns = claudeTurnsRef.current;
    let nid = 0;
    if (turns.length === 0) {
      msgId.current = 1;
      setMessages([{ id: 1, role: "tutor", text: CHAT_MODE_INTRO, type: "info" }]);
      return;
    }
    const rebuilt: ChatMessage[] = turns.map(t => ({
      id: ++nid,
      role: t.role === "user" ? "user" : "tutor",
      text: t.content,
    }));
    msgId.current = nid;
    setMessages(rebuilt);
  }, [claudeTurnsRef]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const processUserMessage = useCallback(
    async (text: string, opts?: { fromVoice?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || chatting) return;

      const voice = { viaVoice: !!opts?.fromVoice };
      const cmd = trimmed.toLowerCase();

      if (cmd === "quit" || cmd === "exit" || cmd === "q") {
        addMsg("user", trimmed, undefined, voice);
        addMsg("tutor", "Bye! 👋", "info");
        setTimeout(onBack, 800);
        return;
      }
      if (cmd === "help" || cmd === "?") {
        addMsg("user", trimmed, undefined, voice);
        addMsg(
          "tutor",
          "**Commands:** hint · why · skip · quiz · report · rephrase · quit\n\n**Voice:** use the mic — your words are **transcribed to text** and sent to the tutor (no audio upload).\n\n**Rephrase quiz questions:**\n- `rephrase: short` — shorter questions\n- `rephrase: step by step` — step-by-step format\n- `clear rephrase` — reset to default\n\nUse the Quiz from home for graded practice.",
          "info"
        );
        return;
      }
      if (cmd === "report") {
        addMsg("user", trimmed, undefined, voice);
        const currentStore = loadStore();
        const lines = skills().map(s => {
          const st = currentStore.states[s.id];
          if (!st) return `- ${s.name}: no data`;
          const proved = masteryProof(st) ? " ✅ MASTERED" : "";
          return `- **${s.name}**: ${summarizeState(st)}${proved}`;
        });
        addMsg("tutor", "📊 **Your mastery:**\n\n" + lines.join("\n"), "report");
        return;
      }
      if (cmd === "why") {
        addMsg("user", trimmed, undefined, voice);
        if (lastSkill) {
          addMsg("tutor", `I picked **${lastSkill}** because: ${lastReason}`, "info");
        } else {
          addMsg("tutor", "No selection info yet.", "info");
        }
        return;
      }
      if (cmd === "hint") {
        addMsg("user", trimmed, undefined, voice);
        if (!pendingItem) {
          addMsg("tutor", "No current question. I'll ask one now!", "info");
          askNext();
        } else {
          addMsg("tutor", hintFor(pendingItem), "hint");
        }
        return;
      }
      if (cmd === "skip") {
        addMsg("user", trimmed, undefined, voice);
        addMsg("tutor", "Skipped. Here's another one! ⏭️", "info");
        askNext();
        return;
      }
      if (cmd.startsWith("rephrase")) {
        addMsg("user", trimmed, undefined, voice);
        let instr = "";
        if (trimmed.includes(":")) {
          instr = trimmed.split(":", 2)[1].trim();
        } else {
          const parts = trimmed.split(" ", 2);
          instr = parts[1]?.trim() || "";
        }
        if (!instr) instr = "short and simple";
        onRewriteChange(instr);
        addMsg(
          "tutor",
          `✏️ Quiz questions will now be rephrased as: **"${instr}"**\n\nThis applies when you start a Quiz from the home screen.`,
          "info"
        );
        return;
      }
      if (cmd === "clear rephrase" || cmd === "clear rewrite" || cmd === "reset style") {
        addMsg("user", trimmed, undefined, voice);
        onRewriteChange("");
        addMsg("tutor", "✏️ Rephrase cleared. Quiz questions will use the default format.", "info");
        return;
      }
      if (cmd === "quiz") {
        addMsg("user", trimmed, undefined, voice);
        askNext();
        return;
      }
      if (cmd === "clear context") {
        addMsg("user", trimmed, undefined, voice);
        setAppContextText(null);
        claudeTurnsRef.current = [];
        addMsg("tutor", "Context cleared. Questions will use built-in items again.", "info");
        return;
      }
      if (trimmed.toLowerCase().startsWith("context:")) {
        addMsg("user", trimmed, undefined, voice);
        const ctx = trimmed.slice(8).trim();
        if (ctx.length < 10) {
          addMsg("tutor", "Context too short. Provide at least a sentence.", "info");
          return;
        }
        claudeTurnsRef.current = [];
        setAppContextText(ctx);
        addMsg(
          "tutor",
          `📎 Context set! I can discuss this material with you.\n\n> "${ctx.slice(0, 200)}${ctx.length > 200 ? "…" : ""}"`,
          "info"
        );
        addMsg("tutor", "Type **quiz** to see a practice question, or ask me anything — typed or by voice.", "info");
        return;
      }

      await sendToClaude(trimmed, voice);
    },
    [chatting, pendingItem, lastSkill, lastReason, addMsg, askNext, onBack, onRewriteChange, sendToClaude, setAppContextText, claudeTurnsRef]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || chatting) return;
    setInput("");
    void processUserMessage(text);
  }, [input, chatting, processUserMessage]);

  const toggleMic = useCallback(() => {
    if (listening) {
      listenStopRef.current?.();
      listenStopRef.current = null;
      setListening(false);
      setLiveTranscript("");
      return;
    }
    if (chatting) return;
    setLiveTranscript("");
    setListening(true);
    const { stop } = startListening({
      onInterim: (preview) => setLiveTranscript(preview),
      onFinal: (spoken) => {
        setListening(false);
        setLiveTranscript("");
        listenStopRef.current = null;
        if (spoken.trim()) void processUserMessage(spoken.trim(), { fromVoice: true });
      },
      onError: (msg) => {
        setListening(false);
        setLiveTranscript("");
        listenStopRef.current = null;
        addMsg("tutor", `🎤 ${msg}`, "hint");
      },
      onEnd: () => {
        setListening(false);
        listenStopRef.current = null;
      },
    });
    listenStopRef.current = stop;
  }, [chatting, listening, processUserMessage, addMsg]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">Chat Tutor</h2>
        </div>
        <p className="text-xs text-muted-foreground max-w-[14rem] hidden sm:block">
          The tutor only receives plain text — what you type or what the mic transcribes. No audio upload.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              if (!ttsAvailable) return;
              if (ttsEnabled) stopSpeaking();
              onTtsEnabledChange(!ttsEnabled);
            }}
            variant="ghost"
            size="sm"
            disabled={!ttsAvailable}
            title={
              ttsAvailable
                ? "Read tutor lines aloud"
                : "TTS unavailable in this browser (try Chrome on desktop)."
            }
            className={`gap-1 ${ttsEnabled && ttsAvailable ? "text-primary" : "text-muted-foreground"}`}
          >
            {ttsEnabled && ttsAvailable ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            {ttsEnabled && ttsAvailable ? "TTS On" : "TTS Off"}
          </Button>
          <Button onClick={onReport} variant="ghost" size="sm" className="gap-1">
            <BarChart3 className="w-3 h-3" /> Report
          </Button>
          <Button onClick={onBack} variant="ghost" size="sm" className="gap-1">
            <Home className="w-3 h-3" /> Home
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {messages.map(msg => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input + quick actions */}
      <div className="border-t border-border bg-card p-4 shrink-0">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => { setInput("hint"); }}>
              <Lightbulb className="w-3 h-3" /> Hint
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => { setInput("why"); }}>
              <HelpCircle className="w-3 h-3" /> Why
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => { setInput("skip"); }}>
              <SkipForward className="w-3 h-3" /> Skip
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => { setInput("report"); }}>
              <BarChart3 className="w-3 h-3" /> Report
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder={appContextText ? "Answer (context active 📎)…" : "Type or speak your message…"}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
              autoFocus
              className="h-11 font-mono flex-1"
              disabled={chatting}
            />
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            <Button variant="outline" size="icon" className="h-11 w-11 shrink-0"
              onClick={() => fileInputRef.current?.click()} title="Upload image for context" disabled={chatting}>
              <ImageIcon className="w-4 h-4" />
            </Button>
            {sttAvailable && (
              <Button
                variant={listening ? "default" : "outline"}
                size="icon"
                className="h-11 w-11 shrink-0"
                title={listening ? "Stop listening" : "Speak — text is sent to the tutor"}
                onClick={toggleMic}
                disabled={chatting}
              >
                <Mic className="w-4 h-4" />
              </Button>
            )}
            <Button onClick={handleSend} disabled={!input.trim() || chatting} className="h-11 px-4">
              <Send className="w-4 h-4" />
            </Button>
          </div>
          {(listening || liveTranscript) && (
            <p className="text-xs text-muted-foreground">
              {listening ? <span className="text-primary animate-pulse">Listening… </span> : null}
              {liveTranscript ? <span className="font-mono">{liveTranscript}</span> : null}
            </p>
          )}
          {appContextText && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>📎 Context active</span>
              <Button variant="ghost" size="sm" className="h-5 text-xs px-1"
                onClick={() => {
                  setAppContextText(null);
                  claudeTurnsRef.current = [];
                  addMsg("tutor", "Context cleared.", "info");
                }}>
                <X className="w-3 h-3" /> Clear
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  const bgMap: Record<string, string> = {
    correct: "bg-success/10 border-success/30",
    incorrect: "bg-destructive/10 border-destructive/30",
    hint: "bg-warning/10 border-warning/30",
    mastery: "bg-accent/10 border-accent/30",
    report: "bg-muted border-border",
    info: "bg-card border-border/60",
  };

  if (isUser) {
    const preview =
      message.text.length > 220 ? `${message.text.slice(0, 220)}…` : message.text;
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5 text-sm">
          {message.text}
        </div>
        {message.viaVoice && (
          <p
            className="max-w-[85%] text-right text-[10px] leading-snug text-muted-foreground"
            title={message.text}
          >
            <span className="font-medium text-muted-foreground/90">Transcript sent to tutor</span>
            <span className="text-muted-foreground/70"> (plain text, not audio):</span>
            <br />
            <span className="font-mono text-foreground/75">&ldquo;{preview}&rdquo;</span>
          </p>
        )}
      </div>
    );
  }

  const bg = bgMap[message.type || "info"] || bgMap.info;

  return (
    <div className="flex justify-start">
      <div className={`max-w-[85%] rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm whitespace-pre-line ${bg}`}>
        <SimpleMarkdown text={message.text} />
      </div>
    </div>
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  // Very simple bold markdown: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── Session View (unchanged) ──
function SessionView({ session, answer, setAnswer, onSubmit, onQuit, store, judging }: {
  session: SessionState;
  answer: string;
  setAnswer: (v: string) => void;
  onSubmit: () => void;
  onQuit: () => void;
  store: TutorStore;
  judging?: boolean;
}) {
  const item = session.currentItem!;
  const hasFeedback = session.feedback !== null;
  const [hint, setHint] = useState<string | null>(null);
  const ttsOk = detectTTS().backend !== null;
  const sttOk = detectSTT().supported;
  const [dictating, setDictating] = useState(false);
  const dictationStopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setHint(null);
  }, [item.id]);

  useEffect(() => {
    return () => {
      dictationStopRef.current?.();
      dictationStopRef.current = null;
    };
  }, []);

  const readQuestionAloud = () => {
    speak(getQuizPromptText(item.prompt));
  };

  const toggleAnswerMic = () => {
    if (judging) return;
    if (dictating) {
      dictationStopRef.current?.();
      dictationStopRef.current = null;
      setDictating(false);
      return;
    }
    setDictating(true);
    const { stop } = startListening({
      onFinal: (t) => {
        dictationStopRef.current = null;
        setDictating(false);
        const spoken = t.trim();
        if (!spoken) return;
        setAnswer(prev => {
          const next = prev ? `${prev} ${spoken}` : spoken;
          return next.trim();
        });
      },
      onError: () => {
        dictationStopRef.current = null;
        setDictating(false);
      },
      onEnd: () => {
        dictationStopRef.current = null;
        setDictating(false);
      },
    });
    dictationStopRef.current = stop;
  };
  const tierColors: Record<string, string> = {
    A: "bg-tier-a text-primary-foreground",
    B: "bg-tier-b text-primary-foreground",
    C: "bg-tier-c text-primary-foreground",
  };
  const skill = skills().find(s => s.id === session.skillId);
  const state = store.states[session.skillId];
  const proved = state && masteryProof(state);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanResult, setScanResult] = useState<ImageScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    const result = await scanImage(file);
    setScanResult(result);
    setScanning(false);
  };

  const clearImage = () => {
    setScanResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* Home button */}
      <div className="w-full max-w-xl mb-6">
        <Button onClick={onQuit} variant="outline" size="sm">
          <Home className="w-3 h-3 mr-1" /> Home
        </Button>
      </div>

      <div className="w-full max-w-xl space-y-6">
        <h2 className="text-2xl font-bold text-foreground">Quiz Question</h2>
        <p className="text-base text-foreground whitespace-pre-line">{getQuizPromptText(item.prompt)}</p>
        {ttsOk && (
          <Button type="button" variant="outline" size="sm" onClick={readQuestionAloud} className="gap-1.5">
            <Volume2 className="w-4 h-4" /> Read question aloud
          </Button>
        )}

        {!hasFeedback ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Type or dictate your answer"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => e.key === "Enter" && answer.trim() && onSubmit()}
                autoFocus
                className="h-12 text-base flex-1"
              />
              {sttOk && (
                <Button
                  type="button"
                  variant={dictating ? "default" : "outline"}
                  size="icon"
                  className="h-12 w-12 shrink-0"
                  title={dictating ? "Stop dictation" : "Dictate — text fills your answer"}
                  onClick={toggleAnswerMic}
                  disabled={judging}
                >
                  <Mic className="w-5 h-5" />
                </Button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              <Button variant="outline" size="icon" className="h-12 w-12 shrink-0"
                onClick={() => fileInputRef.current?.click()} disabled={scanning} title="Upload image">
                <ImageIcon className="w-5 h-5" />
              </Button>
            </div>

            {scanning && <p className="text-sm text-muted-foreground animate-pulse">Scanning image…</p>}

            {scanResult && (
              <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Image Scan</p>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={clearImage}><X className="w-3 h-3" /></Button>
                </div>
                {scanResult.dataUrl && (
                  <img src={scanResult.dataUrl} alt="Uploaded" className="max-h-32 rounded border border-border object-contain" />
                )}
                {scanResult.ocrText && <p className="text-sm">{scanResult.ocrText}</p>}
                {scanResult.warning && <p className="text-xs text-warning">{scanResult.warning}</p>}
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={onSubmit} disabled={!answer.trim() || judging} className="flex-1 h-11">
                {judging ? "Checking…" : "Submit"}
              </Button>
              <Button onClick={() => setHint(hintFor(item, answer))} variant="outline" className="h-11">
                <Lightbulb className="w-4 h-4 mr-1" /> Hint
              </Button>
            </div>

            {hint && (
              <div className="text-sm text-foreground border-l-4 border-primary/60 bg-accent/20 p-3 rounded-r">
                <strong>Hint:</strong> {hint}
              </div>
            )}
          </div>
        ) : session.feedback!.correct ? (
          // Correct — brief flash, auto-advances
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-primary">✅ Correct!</h3>
            <p className="text-muted-foreground">{session.feedback!.text}</p>
            {proved && (
              <p className="text-sm font-semibold text-accent">🎉 Mastery proof reached for {skill?.name}!</p>
            )}
            <p className="text-sm text-muted-foreground animate-pulse">Moving to the next question…</p>
          </div>
        ) : (
          // Wrong — stay on question, let them retry
          <div className="space-y-4">
            <div className="text-sm text-destructive border-l-4 border-destructive/60 bg-destructive/10 p-3 rounded-r">
              <strong>❌ Incorrect.</strong> {session.feedback!.text}
              {item.rubric && <p className="mt-1 text-muted-foreground">📝 {item.rubric}</p>}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Try again…"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => e.key === "Enter" && answer.trim() && onSubmit()}
                autoFocus
                className="h-12 text-base flex-1"
              />
              {sttOk && (
                <Button
                  type="button"
                  variant={dictating ? "default" : "outline"}
                  size="icon"
                  className="h-12 w-12 shrink-0"
                  title={dictating ? "Stop dictation" : "Dictate answer"}
                  onClick={toggleAnswerMic}
                  disabled={judging}
                >
                  <Mic className="w-5 h-5" />
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={onSubmit} disabled={!answer.trim() || judging} className="flex-1 h-11">
                {judging ? "Checking…" : "Try Again"}
              </Button>
              <Button onClick={() => setHint(hintFor(item, answer))} variant="outline" className="h-11">
                <Lightbulb className="w-4 h-4 mr-1" /> Hint
              </Button>
            </div>
            {hint && (
              <div className="text-sm text-foreground border-l-4 border-primary/60 bg-accent/20 p-3 rounded-r">
                <strong>Hint:</strong> {hint}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Question {session.itemIndex + 1} of {session.totalItems} · {skill?.name} · Tier {session.tier}
        </p>
      </div>
    </div>
  );
}

// ── Report View ──
function ReportView({ store, onBack, onStartSession }: {
  store: TutorStore;
  onBack: () => void;
  onStartSession: (n?: number) => void;
}) {
  const allSkills = skills();

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Skills Report</h1>
            <p className="text-sm text-muted-foreground">{store.attempts.length} total attempts</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={onBack} variant="outline" size="sm">Home</Button>
            <Button onClick={() => onStartSession(12)} size="sm" className="gap-1">
              Practice <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3">
          {allSkills.map(skill => {
            const st = store.states[skill.id];
            if (!st) return null;
            const m = mastery(st);
            const proved = masteryProof(st);
            const attempts = store.attempts.filter(a => a.skillId === skill.id);
            const correct = attempts.filter(a => a.correct).length;

            return (
              <Card key={skill.id} className={`border-border/60 transition-all ${proved ? "ring-2 ring-success/40" : ""}`}>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{skill.name}</h3>
                      {proved && <Badge className="bg-success text-success-foreground text-xs">MASTERED</Badge>}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{correct}/{attempts.length}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <p className="text-muted-foreground mb-1">Mastery</p>
                      <Progress value={m * 100} className="h-1.5" />
                      <p className="font-mono mt-1">{(m * 100).toFixed(0)}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Stability</p>
                      <Progress value={st.stability * 100} className="h-1.5" />
                      <p className="font-mono mt-1">{(st.stability * 100).toFixed(0)}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Robustness</p>
                      <Progress value={st.robustness * 100} className="h-1.5" />
                      <p className="font-mono mt-1">{(st.robustness * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
