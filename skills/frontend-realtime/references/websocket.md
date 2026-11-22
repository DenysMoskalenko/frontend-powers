# A raw WebSocket for the app's own protocol

Contents

- [Rules](#rules)
- [The handshake](#the-handshake)
- [Tests](#tests)

Only for a bidirectional protocol the app owns (a game server, collaborative editing against its own
backend). Fan-out to many clients with history is Centrifugo's; one-way streams are SSE's.

## Rules

| Concern | Rule |
| --- | --- |
| Ownership | One module in `src/api/` owns the socket, created per router like `createRealtime` and provided through a Context; components subscribe and never construct a `WebSocket` |
| Auth | The token from `apiToken()` goes in the first frame after `open`; the server answers `ready` or closes. Never in the URL, where proxies and logs keep it |
| Handshake | `open` plus `ready` within a timeout (10 s in `openSocket`); past it, close and treat it as a drop, or a server or proxy that accepts and never answers leaves the caller waiting forever |
| Inbound frames | `JSON.parse` in a `try`, then a zod discriminated union on `type` with `safeParse`; drop what fails, so an older client survives a newer server |
| Reconnect | Full jitter: `Math.random() * Math.min(30_000, 500 * 2 ** attempt)`; reset `attempt` after the connection has stayed open 60 s, not on `open`, or a server that accepts and drops at once is hammered at the minimum delay |
| Heartbeat | The server pings on an interval; the client treats a gap of two intervals as a dead connection and closes it with 4000, then reconnects. Browser sockets cannot send protocol-level pings |
| Back-pressure | Check `socket.bufferedAmount` before `send`; above 1 MiB drop or queue by message kind |
| Close codes | Act on the code, by table, below |
| Offline | Reconnect on the `online` event at once instead of waiting out the backoff |
| Back/forward cache | Close on `pagehide` with `persisted`, reconnect on `pageshow` with `persisted`; an open socket keeps the page out of the bfcache |
| Hidden tab | Keep the socket; disconnect on `visibilitychange` only when the server's cost demands it |
| Protocol version | Add new `type` names; change an existing shape only behind a new protocol version that the server rejects with 4426 |

| Close code | Meaning | Client does |
| --- | --- | --- |
| 1000, 1008, 4403 | normal, policy, forbidden | stop |
| 1001, 1006, 1011, 1012, 1013, other 4xxx | going away, dropped, server error or restart | reconnect with backoff |
| 4401 | token expired | `apiRetryToken(sentToken)` from `src/api/fetcher.ts`, then reconnect once |
| 4426 | client build too old | stop, offer a reload |

## The handshake

```ts,verify
// file: src/api/open-socket.ts
import { z } from "zod";

const Ready = z.object({ type: z.literal("ready") });

const parse = (data: unknown) => {
  try {
    return JSON.parse(String(data)) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Opens a socket of the app's own protocol. The token travels in the first frame, never in the URL,
 * where proxies log it; resolves once the server answers `ready`, rejects if it closes first or
 * does not answer within `timeoutMs`.
 */
export function openSocket(url: string, token: string, timeoutMs = 10_000) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    // A server or proxy that accepts and never answers would leave the caller waiting forever.
    const timer = setTimeout(() => {
      reject(new Error("socket handshake timed out"));
      socket.close(4000, "handshake timeout");
    }, timeoutMs);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token })));
    socket.addEventListener("message", (event) => {
      if (!Ready.safeParse(parse(event.data)).success) return;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      reject(new Error(`socket closed: ${event.code}`));
    });
  });
}
```

## Tests

MSW 3's `ws.link(url)` intercepts the global `WebSocket` in jsdom; a handler listens for
`connection` and talks through `client.send` and `client.close`. A socket with no handler gets an
`error` event and MSW prints `intercepted a WebSocket connection without a matching event handler`,
but the setup file's `afterEach` counts only HTTP requests, so the test does not fail on it: assert
what the app shows instead. Reconnect delays are timers: `vi.useFakeTimers()` and
`vi.advanceTimersByTimeAsync`.

```ts,verify,test
import { ws } from "msw";
import { expect, test } from "vitest";
import { openSocket } from "@/api/open-socket";
import { server } from "@/test/server";

const game = ws.link("wss://rt.test/game");

test("the token goes in the first frame, and the socket opens on ready", async () => {
  const frames: unknown[] = [];
  server.use(
    game.addEventListener("connection", ({ client }) => {
      client.addEventListener("message", (event) => {
        frames.push(JSON.parse(String(event.data)));
        client.send(JSON.stringify({ type: "ready" }));
      });
    }),
  );

  const socket = await openSocket("wss://rt.test/game", "token-1");

  expect(frames).toEqual([{ type: "auth", token: "token-1" }]);
  expect(socket.url).toBe("wss://rt.test/game");
  socket.close();
});

test("a server that closes instead of ready rejects with the close code", async () => {
  server.use(
    game.addEventListener("connection", ({ client }) => {
      client.addEventListener("message", () => client.close(4401, "token expired"));
    }),
  );

  await expect(openSocket("wss://rt.test/game", "stale")).rejects.toThrow("socket closed: 4401");
});

test("a server that accepts and never answers rejects after the handshake timeout", async () => {
  server.use(game.addEventListener("connection", () => {}));

  await expect(openSocket("wss://rt.test/game", "token-1", 50)).rejects.toThrow(
    "socket handshake timed out",
  );
});
```
