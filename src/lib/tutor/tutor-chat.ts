import { supabase } from "@/integrations/supabase/client";

export type TutorChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Claude chat uses the same deployed Edge Function as quiz grading (`judge-answer`)
 * with `mode: "tutor-chat"` so you only deploy one function.
 */
export async function tutorChat(
  messages: TutorChatTurn[],
  sessionContext?: string
): Promise<{ text: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("judge-answer", {
      body: {
        mode: "tutor-chat",
        messages,
        sessionContext: sessionContext ?? "",
      },
    });

    if (error) {
      console.error("tutor-chat (judge-answer) error:", error);
      const hint =
        (error as { message?: string }).message?.includes("Failed to fetch") ||
        (error as { message?: string }).message?.includes("NetworkError")
          ? " Network or CORS issue — check Supabase URL and that the function is deployed."
          : "";
      return { text: "", error: `Could not reach the tutor.${hint} Try again.` };
    }

    if (data?.error) {
      return { text: "", error: typeof data.error === "string" ? data.error : "Tutor error." };
    }

    return { text: (data?.text as string) || "" };
  } catch (e) {
    console.error("tutor-chat exception:", e);
    return { text: "", error: "Could not reach the tutor. Try again." };
  }
}
