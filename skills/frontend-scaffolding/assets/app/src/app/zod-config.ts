import * as z from "zod";

// The CSP forbids eval. Without `jitless`, every object schema probes `new Function` as it is built
// and the browser reports a Trusted Types violation. vite.config.ts bundles this with zod itself, so
// it runs before any schema is built, whatever the chunking.
z.config({ jitless: true });
