// Node 24 strips the erasable TypeScript syntax in this dependency-free module.
import { deploymentMode } from "../../src/config/deployment.ts";
const mode = deploymentMode(process.env);
if (
  ["production", "preview", "invalid"].includes(mode) ||
  process.env.VERCEL ||
  process.env.VERCEL_ENV
)
  throw Error("Local fixtures are forbidden on deployed environments");
