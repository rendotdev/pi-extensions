import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { defineApp } from "../../define.ts";
import { HomeRoute, ReviewDiffPresentation } from "../../domains/review/ui/index.ts";

defineApp({
  params: { rootId: "root" },
  deps: {
    createRoot,
    queryClient: new QueryClient(),
    reviewDiffPresentation: new ReviewDiffPresentation(),
  },
  run() {
    this.deps.createRoot(document.getElementById(this.params.rootId)!).render(
      <>
        <Toast.Provider placement="bottom end" />
        <QueryClientProvider client={this.deps.queryClient}>
          <WorkerPoolContextProvider
            poolOptions={{
              poolSize: Math.min(4, navigator.hardwareConcurrency || 2),
              workerFactory: () => new DiffsWorker(),
            }}
            highlighterOptions={this.deps.reviewDiffPresentation.highlighterOptions({})}
          >
            <HomeRoute />
          </WorkerPoolContextProvider>
        </QueryClientProvider>
      </>,
    );
  },
});
