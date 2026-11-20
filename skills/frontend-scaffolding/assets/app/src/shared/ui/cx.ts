/** Joins complete class strings; listed in biome.json `tailwind.mergeFunctions` so its arguments are linted. */
export const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");
