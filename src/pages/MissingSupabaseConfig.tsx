import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function MissingSupabaseConfig() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-lg w-full border-border/60">
        <CardHeader>
          <CardTitle>Configuration needed</CardTitle>
          <CardDescription>
            Supabase environment variables are missing, so the app can’t start. Add them where you host the
            app, then redeploy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Set these in <strong className="text-foreground">Vercel</strong> → Project → Settings → Environment Variables (Production and Preview):</p>
          <ul className="list-disc pl-5 space-y-1 font-mono text-xs text-foreground">
            <li>VITE_SUPABASE_URL</li>
            <li>VITE_SUPABASE_PUBLISHABLE_KEY</li>
          </ul>
          <p>Copy values from your Supabase project → Settings → API (Project URL and anon public key).</p>
          <p className="text-xs">Vite reads these at <strong className="text-foreground">build</strong> time — trigger a new deployment after saving.</p>
        </CardContent>
      </Card>
    </div>
  );
}
