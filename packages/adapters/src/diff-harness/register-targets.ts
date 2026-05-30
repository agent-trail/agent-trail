// Side-effect module: registers every migrated adapter's diff-harness target.
// Imported by the CLI runner (scripts/diff-harness.ts) so `bun run diff:adapters`
// compares old vs new. Kept separate from the generic harness so diff-harness/
// stays adapter-agnostic and its unit tests run against an empty registry.
import { piV2HarnessTarget } from "../pi/v2/harness-target.ts";
import { v2HarnessTargets } from "./index.ts";

v2HarnessTargets.push(piV2HarnessTarget);
