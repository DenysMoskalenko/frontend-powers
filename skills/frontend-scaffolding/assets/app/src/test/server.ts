import { setupServer } from "msw/node";

/** No default handlers: each test states the API answers its page needs with `server.use(...)`. */
export const server = setupServer();
