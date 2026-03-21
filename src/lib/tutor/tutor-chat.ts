import { supabase } from "@/integrations/supabase/client";

export type TutorChatTurn = { role: "user" | "assistant"; content: string };

export async function tutorChat(
  messages: TutorChatTurn[],
  sessionContext?: string
): Promise<{ text: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("tutor-chat", {
      body: { messages, sessionContext: sessionContext ?? "" },
    });

    if (error) {
      console.error("tutor-chat error:", error);
      return { text: "", error: "Could not reach the tutor. Try again." };
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
