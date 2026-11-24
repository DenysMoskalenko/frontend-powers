import * as z from "zod";

// The CSP forbids eval. Without `jitless`, zod probes `new Function` once, as the first object schema
// is built, and the browser reports a Trusted Types violation. vite.config.ts bundles this with zod
// itself, so it runs before any schema is built, whatever the chunking.
z.config({ jitless: true });
