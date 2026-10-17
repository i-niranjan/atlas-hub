import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { DaemonOffline, isTauri } from "./lib/api.ts";
import "./styles.css";

if (isTauri) document.documentElement.classList.add("tauri");

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Live SSE events drive freshness; don't refetch on every focus.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof DaemonOffline) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
