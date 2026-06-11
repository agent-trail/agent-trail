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
  const prd = await readText("docs/PRD.md");
  const prdSectionNumbers = collectSectionNumbers(prd);

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
  const decreasingRanges: string[] = [];

  for (const file of files) {
    const text = await readText(file);
    for (const stale of findStaleRefs(text)) {
      staleRefs.push(`${file}:${lineForOffset(text, stale.index)} ${stale.ref}`);
    }
    for (const ref of findSectionRefs(text, file)) {
      if (!sectionNumbers.has(ref.section)) {
        danglingRefs.push(`${file}:${lineForOffset(text, ref.index)} §${ref.section}`);
      }
      if (ref.rangeEnd !== undefined && compareSectionNumbers(ref.rangeEnd, ref.section) < 0) {
        decreasingRanges.push(`${file}:${lineForOffset(text, ref.index)} ${ref.raw}`);
      }
    }
    for (const ref of findPrdRefs(text, file)) {
      if (!prdSectionNumbers.has(ref.section)) {
        danglingRefs.push(`${file}:${lineForOffset(text, ref.index)} PRD §${ref.section}`);
      }
      if (ref.rangeEnd !== undefined && compareSectionNumbers(ref.rangeEnd, ref.section) < 0) {
        decreasingRanges.push(`${file}:${lineForOffset(text, ref.index)} ${ref.raw}`);
      }
    }
  }

  expect(staleRefs).toEqual([]);
  expect(danglingRefs).toEqual([]);
  expect(decreasingRanges).toEqual([]);
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

function findStaleRefs(text: string): Array<{ ref: string; index: number }> {
  const stalePatterns = [
    /§(?:8\.0|16\.4|17\.4)\b/g,
    /§10\.2-9\.3\b/g,
    /§13\.1-12\.3\b/g,
    /spec §8\.5(?=[^.\n]*(?:session_uid|reconcil))/gi,
    /§8\.6(?=[^.\n]*multi-session)/gi,
  ];
  return stalePatterns.flatMap((pattern) =>
    Array.from(text.matchAll(pattern), (match) => ({
      ref: match[0],
      index: match.index ?? 0,
    })),
  );
}

function findSectionRefs(
  text: string,
  file: string,
): Array<{ section: string; rangeEnd?: string; raw: string; index: number }> {
  const pattern =
    file === "spec.md"
      ? /§(\d+(?:\.\d+)*)(?:-(\d+(?:\.\d+)*))?/g
      : /\bspec §(\d+(?:\.\d+)*)(?:-(\d+(?:\.\d+)*))?/gi;
  return Array.from(text.matchAll(pattern), (match) => ({
    section: match[1]!,
    rangeEnd: match[2],
    raw: match[0],
    index: match.index ?? 0,
  }));
}

function findPrdRefs(
  text: string,
  file: string,
): Array<{ section: string; rangeEnd?: string; raw: string; index: number }> {
  const refs = Array.from(
    text.matchAll(/\bPRD §(\d+(?:\.\d+)*)(?:-(\d+(?:\.\d+)*))?/gi),
    (match) => ({
      section: match[1]!,
      rangeEnd: match[2],
      raw: match[0],
      index: match.index ?? 0,
    }),
  );

  if (file !== "docs/PRD.md") return refs;

  const barePrdRefs = Array.from(
    text.matchAll(/(?:^|[^\w])(?<!spec )§(\d+(?:\.\d+)*)(?:-(\d+(?:\.\d+)*))?/gi),
    (match) => ({
      section: match[1]!,
      rangeEnd: match[2],
      raw: match[0].trimStart(),
      index: (match.index ?? 0) + match[0].indexOf("§"),
    }),
  );
  return [...refs, ...barePrdRefs];
}

function compareSectionNumbers(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
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
