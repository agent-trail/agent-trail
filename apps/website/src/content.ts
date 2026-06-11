import parserSourceMatrix from "../../../docs/parser-source-matrix.md?raw";
import redactionPatterns from "../../../docs/redaction-patterns.md?raw";
import schemaJson from "../../../schema.json?raw";
import specMarkdown from "../../../spec.md?raw";

const repoText = {
  "docs/parser-source-matrix.md": parserSourceMatrix,
  "docs/redaction-patterns.md": redactionPatterns,
  "schema.json": schemaJson,
  "spec.md": specMarkdown,
};

export async function readRepoText(path: string): Promise<string> {
  const text = repoText[path as keyof typeof repoText];
  if (text === undefined) {
    throw new Error(`unsupported website content path: ${path}`);
  }
  return text;
}
