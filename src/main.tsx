import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import MissingSupabaseConfig from "./pages/MissingSupabaseConfig.tsx";
import "./index.css";

const App = lazy(() => import("./App.tsx"));

function isSupabaseEnvReady(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return typeof url === "string" && url.trim().length > 0 && typeof key === "string" && key.trim().length > 0;
}

function Root() {
  if (!isSupabaseEnvReady()) {
    return <MissingSupabaseConfig />;
  }
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
          Loading…
        </div>
      }
    >
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
