import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

const rootUrl = new URL("../", import.meta.url);

const checkedRoots = [
  "spec.md",
  "schema.json",
  "README.md",
  "CONTEXT.md",
  "docs",
  "packages/core",
  "packages/adapters",
  "packages/adapter-kit",
  "packages/cli",
  "packages/redact",
  "packages/schema/schema.json",
  "packages/store",
  "packages/types/index.d.ts",
];

test("spec section numbers and cross-references are editorially consistent", async () => {
  const spec = await readText("spec.md");
  const sectionNumbers = collectSectionNumbers(spec);
  const topLevelNumbers = collectTopLevelNumbers(spec);

  expect(topLevelNumbers).toEqual([...topLevelNumbers].sort((a, b) => a - b));
  expect(spec).not.toMatch(/^## 8\.0\b/m);
  expect(sectionNumbers).toContain("8");
  expect(sectionNumbers).toContain("9");
  expect(sectionNumbers).toContain("18.4");
  expect(sectionNumbers).toContain("19");
  expect(sectionNumbers).toContain("20");

  const files = await collectCheckedFiles();
  const staleRefs: string[] = [];
  const danglingRefs: string[] = [];

  for (const file of files) {
    const text = await readText(file);
    for (const stale of text.matchAll(/§(?:8\.0|16\.4|17\.4)\b/g)) {
      staleRefs.push(`${file}:${lineForOffset(text, stale.index ?? 0)} ${stale[0]}`);
    }
    const refPattern = file === "spec.md" ? /§(\d+(?:\.\d+)*)/g : /\bspec §(\d+(?:\.\d+)*)/gi;
    for (const ref of text.matchAll(refPattern)) {
      const section = ref[1];
      if (section !== undefined && !sectionNumbers.has(section)) {
        danglingRefs.push(`${file}:${lineForOffset(text, ref.index ?? 0)} §${section}`);
      }
    }
  }

  expect(staleRefs).toEqual([]);
  expect(danglingRefs).toEqual([]);
});

function collectSectionNumbers(markdown: string): Set<string> {
  const numbers = new Set<string>();
  for (const match of markdown.matchAll(/^#{2,4} (\d+(?:\.\d+)*)\b/gm)) {
    if (match[1] !== undefined) numbers.add(match[1]);
  }
  return numbers;
}

function collectTopLevelNumbers(markdown: string): number[] {
  return Array.from(markdown.matchAll(/^## (\d+)\.?\s/gm), (match) => Number(match[1]));
}

async function collectCheckedFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const root of checkedRoots) {
    await collect(root, out);
  }
  return [...new Set(out)].sort();
}

async function collect(path: string, out: string[]): Promise<void> {
  if (path.endsWith(".md") || path.endsWith(".json") || path.endsWith(".ts")) {
    out.push(path);
    return;
  }

  for (const entry of await readdir(new URL(`${path}/`, rootUrl), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await collect(child, out);
      continue;
    }
    if (entry.isFile() && /\.(md|json|ts)$/.test(entry.name)) {
      out.push(child);
    }
  }
}

async function readText(path: string): Promise<string> {
  return readFile(new URL(path, rootUrl), "utf8");
}

function lineForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}
