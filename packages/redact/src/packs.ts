import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { containsAllowedSecretToken } from "./allowed-secret-tokens.ts";
import { DEFAULT_PATTERNS } from "./patterns.ts";
import { assertSafeRegexSource } from "./regex-safety.ts";
import type {
  LoadedRedactionPack,
  PiiConfig,
  RedactionPackSource,
  RedactionPattern,
} from "./types.ts";

type Env = Record<string, string | undefined>;

export type RedactionConfig = {
  packs: LoadedRedactionPack[];
  allowedSecrets: string[];
  pii?: PiiConfig;
  warnings: string[];
};

export type ResolveRedactionConfigOptions = {
  env?: Env;
  projectRoot?: string;
};

type PackRule = {
  id: string;
  description: string;
  regex: string;
  placeholder: string;
  samples?: PackSample[];
};

type PackSample = {
  input: string;
  redacted: boolean;
};

const MAX_PACK_BYTES = 1024 * 1024;
const MAX_PACK_FILES = 256;
const PACK_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);
const RULE_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export async function resolveRedactionConfig(
  options: ResolveRedactionConfigOptions = {},
): Promise<RedactionConfig> {
  const env = options.env ?? process.env;
  const projectRoot = await realpath(resolve(options.projectRoot ?? process.cwd()));
  const home = env.HOME ?? env.USERPROFILE;
  const settingsPaths = [
    join(projectRoot, ".trail", "settings.json"),
    ...(home === undefined || home.length === 0
      ? []
      : [join(home, ".config", "trail", "settings.json")]),
  ];
  const roots: Array<{ source: RedactionPackSource; path: string }> = [
    { source: "project", path: join(projectRoot, ".trail", "redactors") },
  ];
  if (home !== undefined && home.length > 0) {
    roots.push({ source: "user_global", path: join(home, ".config", "trail", "redactors") });
  }

  const warnings: string[] = [];
  const settings = await readSettings(settingsPaths);
  const packs: LoadedRedactionPack[] = [];
  const patternIds = new Set(DEFAULT_PATTERNS.map((pattern) => pattern.id));
  const packNames = new Set<string>();
  let fileCount = 0;
  for (const root of roots) {
    const files = await collectPackFiles(root.path, warnings, MAX_PACK_FILES - fileCount);
    fileCount += files.length;
    for (const file of files) {
      const pack = await loadPackFile(file, root.source, warnings, patternIds, packNames);
      if (pack !== null) packs.push(pack);
    }
  }

  return {
    packs,
    allowedSecrets: [
      ...(settings.allowedSecrets ?? []),
      ...packs.flatMap((pack) => pack.allowlist),
    ],
    pii: settings.pii,
    warnings,
  };
}

type RedactionSettings = {
  allowedSecrets?: string[];
  pii?: PiiConfig;
};

async function readSettings(paths: string[]): Promise<RedactionSettings> {
  let settings: RedactionSettings = {};
  for (const path of paths) {
    const stats = await lstatOrNull(path);
    if (stats === null) continue;
    if (stats.isSymbolicLink()) throw new Error(`redaction settings refuses symlink: ${path}`);
    if (!stats.isFile()) throw new Error(`redaction settings must be a file: ${path}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      throw new Error(`redaction settings invalid JSON: ${path}`);
    }
    settings = mergeSettings(settings, parseSettings(path, parsed));
  }
  return settings;
}

function mergeSettings(base: RedactionSettings, next: RedactionSettings): RedactionSettings {
  return {
    allowedSecrets:
      next.allowedSecrets === undefined
        ? base.allowedSecrets
        : unique([...(base.allowedSecrets ?? []), ...next.allowedSecrets]),
    pii:
      next.pii === undefined
        ? base.pii
        : {
            ...(base.pii ?? {}),
            ...next.pii,
            emailAllowlist:
              next.pii.emailAllowlist === undefined
                ? base.pii?.emailAllowlist
                : unique([...(base.pii?.emailAllowlist ?? []), ...next.pii.emailAllowlist]),
            customLabels:
              next.pii.customLabels === undefined
                ? base.pii?.customLabels
                : { ...(base.pii?.customLabels ?? {}), ...next.pii.customLabels },
          },
  };
}

function parseSettings(path: string, value: unknown): RedactionSettings {
  if (!isPlainObject(value)) throw new Error(`redaction settings must be an object: ${path}`);
  const redaction = value.redaction;
  if (redaction === undefined) return {};
  if (!isPlainObject(redaction)) {
    throw new Error(`redaction settings redaction must be an object: ${path}`);
  }
  return {
    allowedSecrets: optionalStringArrayField(redaction, "allowedSecrets"),
    pii: parsePiiConfig(path, redaction.pii),
  };
}

function parsePiiConfig(path: string, value: unknown): PiiConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`redaction settings pii must be an object: ${path}`);
  const out: PiiConfig = {};
  for (const key of ["email", "phone", "ssn", "creditCard", "name"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "boolean") {
      throw new Error(`redaction settings pii.${key} must be a boolean: ${path}`);
    }
    out[key] = field;
  }
  const creditCardSnake = value.credit_card;
  if (creditCardSnake !== undefined) {
    if (typeof creditCardSnake !== "boolean") {
      throw new Error(`redaction settings pii.credit_card must be a boolean: ${path}`);
    }
    out.creditCard = creditCardSnake;
  }
  out.emailAllowlist = optionalStringArrayField(value, "emailAllowlist");
  if (out.emailAllowlist !== undefined) {
    for (const pattern of out.emailAllowlist) {
      if (!isValidEmailAllowlistPattern(pattern)) {
        throw new Error(
          `redaction settings pii.emailAllowlist contains invalid pattern '${pattern}': ${path}`,
        );
      }
    }
  }
  if (value.customLabels !== undefined) {
    if (!isPlainObject(value.customLabels)) {
      throw new Error(`redaction settings pii.customLabels must be an object: ${path}`);
    }
    out.customLabels = {};
    for (const [key, regex] of Object.entries(value.customLabels)) {
      if (typeof regex !== "string" || regex.length === 0) {
        throw new Error(`redaction settings pii.customLabels.${key} must be a string: ${path}`);
      }
      assertSafeRegexSource(regex, `redaction settings pii.customLabels.${key}`);
      out.customLabels[key] = regex;
    }
  }
  return out;
}

async function collectPackFiles(
  root: string,
  warnings: string[],
  maxFiles: number,
): Promise<string[]> {
  if (maxFiles <= 0) {
    warnings.push(`redaction pack limit exceeded; skipped ${root}`);
    return [];
  }
  const stats = await lstatOrNull(root);
  if (stats === null) return [];
  if (stats.isSymbolicLink()) {
    warnings.push(`redaction pack directory skipped symlink: ${root}`);
    return [];
  }
  if (!stats.isDirectory()) {
    warnings.push(`redaction pack root is not a directory: ${root}`);
    return [];
  }
  const files: string[] = [];
  await walkPackDir(root, files, warnings, maxFiles, { warned: false });
  return files.sort();
}

async function walkPackDir(
  dir: string,
  files: string[],
  warnings: string[],
  maxFiles: number,
  limitState: { warned: boolean },
): Promise<void> {
  if (files.length >= maxFiles) {
    warnPackLimit(dir, warnings, limitState);
    return;
  }
  let entries: Array<{
    name: string;
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    warnings.push(`redaction pack directory unreadable: ${dir}: ${messageFor(error)}`);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= maxFiles) {
      warnPackLimit(dir, warnings, limitState);
      return;
    }
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      warnings.push(`redaction pack skipped symlink: ${path}`);
      continue;
    }
    if (entry.isDirectory()) {
      await walkPackDir(path, files, warnings, maxFiles, limitState);
      continue;
    }
    if (entry.isFile() && PACK_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
}

function warnPackLimit(dir: string, warnings: string[], limitState: { warned: boolean }): void {
  if (limitState.warned) return;
  limitState.warned = true;
  warnings.push(`redaction pack limit exceeded; skipped remaining files under ${dir}`);
}

async function loadPackFile(
  path: string,
  source: RedactionPackSource,
  warnings: string[],
  patternIds: Set<string>,
  packNames: Set<string>,
): Promise<LoadedRedactionPack | null> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      warnings.push(`redaction pack skipped symlink: ${path}`);
      return null;
    }
    if (!stats.isFile()) return null;
    if (stats.size > MAX_PACK_BYTES) {
      warnings.push(`redaction pack too large: ${path}`);
      return null;
    }
    const bytes = await readFile(path);
    const parsed = parsePackBytes(path, bytes);
    const name = packName(path, parsed);
    if (packNames.has(name)) {
      warnings.push(`redaction pack duplicate name skipped: ${path}`);
      return null;
    }
    const pack = compilePack(path, source, bytes, parsed, patternIds);
    packNames.add(pack.name);
    return pack;
  } catch (error) {
    warnings.push(`redaction pack skipped ${path}: ${messageFor(error)}`);
    return null;
  }
}

function parsePackBytes(path: string, bytes: Buffer): unknown {
  const raw = bytes.toString("utf8");
  if (extname(path).toLowerCase() === ".json") return JSON.parse(raw) as unknown;
  return parseYaml(raw) as unknown;
}

function compilePack(
  path: string,
  source: RedactionPackSource,
  bytes: Buffer,
  value: unknown,
  patternIds: Set<string>,
): LoadedRedactionPack {
  if (!isPlainObject(value)) throw new Error("pack must be an object");
  const name = packName(path, value);
  const version = numberField(value, "version");
  const rules = arrayField(value, "rules");
  const seen = new Set<string>();
  const patterns: RedactionPattern[] = [];
  for (const ruleValue of rules) {
    const rule = parseRule(ruleValue);
    if (seen.has(rule.id)) throw new Error(`duplicate rule id: ${rule.id}`);
    if (patternIds.has(rule.id)) throw new Error(`duplicate global rule id: ${rule.id}`);
    seen.add(rule.id);
    assertSafeRegexSource(rule.regex, `rule ${rule.id}`);
    const regex = new RegExp(rule.regex, "g");
    const pattern = {
      id: rule.id,
      description: rule.description,
      regex,
      placeholder: rule.placeholder,
    };
    assertSamplesPass(pattern, rule.samples ?? []);
    patterns.push(pattern);
  }
  for (const pattern of patterns) patternIds.add(pattern.id);
  return {
    name,
    version,
    path,
    source,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    patterns,
    allowlist: optionalStringArrayField(value, "allowlist") ?? [],
  };
}

function packName(path: string, value: unknown): string {
  if (!isPlainObject(value)) throw new Error("pack must be an object");
  const filenameStem = basename(path, extname(path));
  const name = stringField(value, "name");
  if (name !== filenameStem) {
    throw new Error(`pack name '${name}' must match filename stem '${filenameStem}'`);
  }
  return name;
}

function parseRule(value: unknown): PackRule {
  if (!isPlainObject(value)) throw new Error("rule must be an object");
  const id = stringField(value, "id");
  if (!RULE_ID_PATTERN.test(id)) {
    throw new Error(`invalid rule id: ${id}`);
  }
  const placeholder = stringField(value, "placeholder");
  if (containsAllowedSecretToken(placeholder)) {
    throw new Error(`placeholder uses reserved allowed-secret token namespace: ${id}`);
  }
  if (containsActiveReplacementToken(placeholder)) {
    throw new Error(`placeholder uses unsafe replacement token: ${id}`);
  }
  return {
    id,
    description: stringField(value, "description"),
    regex: stringField(value, "regex"),
    placeholder,
    samples: optionalSamples(value.samples),
  };
}

function assertSamplesPass(pattern: RedactionPattern, samples: PackSample[]): void {
  for (const sample of samples) {
    const matches = Array.from(sample.input.matchAll(pattern.regex), (match) => match[0] ?? "");
    pattern.regex.lastIndex = 0;
    const output = sample.input.replace(pattern.regex, pattern.placeholder);
    const redacted =
      output !== sample.input &&
      matches.length > 0 &&
      matches.every((matched) => matched.length === 0 || !output.includes(matched));
    pattern.regex.lastIndex = 0;
    if (redacted !== sample.redacted) {
      throw new Error(`sample failed for rule ${pattern.id}: ${sample.input}`);
    }
  }
}

function optionalSamples(value: unknown): PackSample[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("samples must be an array");
  return value.map((sample) => {
    if (!isPlainObject(sample)) throw new Error("sample must be an object");
    const input = stringField(sample, "input");
    const redacted = sample.redacted;
    if (typeof redacted !== "boolean") throw new Error("sample.redacted must be a boolean");
    return { input, redacted };
  });
}

function containsActiveReplacementToken(placeholder: string): boolean {
  for (let index = 0; index < placeholder.length - 1; index += 1) {
    if (placeholder[index] !== "$") continue;
    const next = placeholder[index + 1];
    if (next === "$") {
      index += 1;
      continue;
    }
    if (next === "&" || next === "`" || next === "'" || /[1-9]/.test(next ?? "")) return true;
  }
  return false;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const array = value[key];
  if (!Array.isArray(array)) throw new Error(`${key} must be an array`);
  return array.map((item) => {
    if (typeof item !== "string") throw new Error(`${key} entries must be strings`);
    return item;
  });
}

function optionalStringArrayField(
  value: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (value[key] === undefined) return undefined;
  return stringArrayField(value, key);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return field;
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`${key} must be a number`);
  }
  return field;
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`${key} must be an array`);
  return field;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ((error as Record<string, unknown>).code === "ENOENT" ||
        (error as Record<string, unknown>).code === "ENOTDIR")
    ) {
      return null;
    }
    throw error;
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isValidEmailAllowlistPattern(pattern: string): boolean {
  if (pattern.includes("*")) {
    if (pattern.endsWith("@*")) return /^[^@\s*]+@\*$/.test(pattern);
    if (pattern.startsWith("*@")) return /^\*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(pattern);
    return false;
  }
  return /^[^@\s]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(pattern);
}
