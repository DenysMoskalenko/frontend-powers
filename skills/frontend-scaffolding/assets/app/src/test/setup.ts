import "@testing-library/jest-dom/vitest";
import { faker } from "@faker-js/faker";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";

// The bound only ends a hang; a loaded CI machine must never reach it.
configure({ asyncUtilTimeout: 5_000 });
// jsdom has no layout; the router restores scroll after every navigation.
window.scrollTo = () => {};

const unhandled: string[] = [];
server.events.on("request:unhandled", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

// jsdom has no reportError. An error the app reports fails the test unless the test stubs it.
const reported: unknown[] = [];
globalThis.reportError = (error: unknown) => {
  reported.push(error);
};

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  // Same data whatever the shuffle order, so a failure reproduces.
  faker.seed(20_261_119);
});
afterEach(() => {
  // `globals: false` turns off Testing Library's automatic cleanup.
  cleanup();
  // Also undoes a bare vi.setSystemTime(), which no config option resets.
  vi.useRealTimers();
  server.resetHandlers();
  // The app may turn a failed request into an error screen and the test still pass: fail it here.
  const requests = unhandled.splice(0);
  const errors = reported.splice(0);
  if (requests.length > 0)
    throw new Error(`Requests without an MSW handler: ${requests.join(", ")}`);
  if (errors.length > 0) throw new AggregateError(errors, "The app called reportError");
});
afterAll(() => server.close());
