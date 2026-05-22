import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const canonicalUrl = new URL("schema.json", rootUrl);
const mirroredUrl = new URL("packages/schema/schema.json", rootUrl);
const checkOnly = process.argv.includes("--check");

const canonical = await readFile(canonicalUrl, "utf8");

if (checkOnly) {
  const mirrored = await readFile(mirroredUrl, "utf8").catch(() => "");
  if (canonical !== mirrored) {
    console.error(
      `${fileURLToPath(mirroredUrl)} is out of sync with ${fileURLToPath(canonicalUrl)}. Run bun run sync:schema.`,
    );
    process.exit(1);
  }
} else {
  await writeFile(mirroredUrl, canonical);
}
