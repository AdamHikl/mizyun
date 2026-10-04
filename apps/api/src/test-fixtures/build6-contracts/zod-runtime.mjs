import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Resolve the same Zod dependency as the shipped contracts, without importing current schemas.
export const { z } = createRequire(require.resolve("@mizyun/contracts"))("zod");
