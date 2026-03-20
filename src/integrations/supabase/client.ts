import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { publicClientConfig } from "./public-client-config";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || publicClientConfig.url;
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || publicClientConfig.anonKey;

export const supabase = createClient<Database>(url, key, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
