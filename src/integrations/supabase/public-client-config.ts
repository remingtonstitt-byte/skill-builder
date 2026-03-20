/**
 * Default Supabase client URL + anon key (safe to ship in the browser; protect data with RLS).
 * Override with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY when you rotate keys or use another project.
 */
export const publicClientConfig = {
  url: "https://hrtonntmqbuewtqqfbkp.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydG9ubnRtcWJ1ZXd0cXFmYmtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjQ0NDEsImV4cCI6MjA4OTQ0MDQ0MX0.sgl2cuu5494WuIFscFYuOyJFhTA2p7C40uMxDTNxHEA",
} as const;
