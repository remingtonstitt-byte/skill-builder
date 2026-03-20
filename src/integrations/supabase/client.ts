import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function requireViteEnv(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY", value: string | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Missing ${name}. For Vercel: Project → Settings → Environment Variables → add it for Production (and Preview), then Redeploy. Local: copy .env.example to .env.`,
    );
  }
  return value.trim();
}

const SUPABASE_URL = requireViteEnv("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_PUBLISHABLE_KEY = requireViteEnv(
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});