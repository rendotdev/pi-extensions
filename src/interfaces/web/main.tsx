import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { ReviewDiffPresentation } from "./review-diff-presentation.ts";
import { HomeRoute } from "./routes/home/home-route.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <>
    <Toast.Provider placement="bottom end" />
    <QueryClientProvider client={queryClient}>
      <WorkerPoolContextProvider
        poolOptions={{
          poolSize: Math.min(4, navigator.hardwareConcurrency || 2),
          workerFactory: () => new DiffsWorker(),
        }}
        highlighterOptions={ReviewDiffPresentation.highlighterOptions()}
      >
        <HomeRoute />
      </WorkerPoolContextProvider>
    </QueryClientProvider>
  </>,
);
