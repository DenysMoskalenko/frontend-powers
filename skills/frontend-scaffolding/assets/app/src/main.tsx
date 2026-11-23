import "@/app/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApi } from "@/api/fetcher";
import { env } from "@/app/env";
import { reloadOnStaleChunk, rootErrorHandlers } from "@/app/error-reporting";
import { createAppRouter } from "@/app/router";
import "@/styles.css";

configureApi({ baseUrl: env.apiOrigin });
const router = createAppRouter();
reloadOnStaleChunk(router);

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root");
createRoot(container, rootErrorHandlers).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
