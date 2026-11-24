import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { ApiError } from "@/api/api-error";
import { Button } from "./button";

/** The router's `defaultErrorComponent`: the page failed to load or render. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { reset } = useQueryErrorResetBoundary();
  // A query that failed inside the boundary would otherwise rethrow its cached error on retry.
  useEffect(() => reset(), [reset]);

  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <title>This page could not be loaded</title>
      <h1 className="font-semibold text-xl">This page could not be loaded</h1>
      {error instanceof ApiError && error.requestId ? <p>Request id: {error.requestId}</p> : null}
      <Button onClick={() => router.invalidate()}>Try again</Button>
    </div>
  );
}
