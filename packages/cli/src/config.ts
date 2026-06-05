import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export type TrailConfig = {
  sources?: {
    defaultFilter?: string | null;
  };
  tui?: {
    previewByteCap?: number;
    previewEventCap?: number;
  };
  keymap?: Record<string, unknown>;
};

export type ResolvedTrailConfig = {
  sources: {
    defaultFilter: string | null;
  };
  tui: {
    previewByteCap: number;
    previewEventCap: number;
  };
  keymap: Record<string, unknown>;
};

export type ConfigLayer = "built_in" | "user_global" | "project_committed" | "project_local";

export type ConfigSourceStatus = "default" | "loaded" | "missing";

export type ConfigSource = {
  layer: ConfigLayer;
  path: string | null;
  status: ConfigSourceStatus;
};

export type ResolvedConfig = {
  config: ResolvedTrailConfig;
  sources: ConfigSource[];
};

export type ResolveConfigOptions = {
  env?: Env;
  projectRoot?: string;
};

export type ScaffoldProjectConfigOptions = {
  projectRoot?: string;
};

export type ScaffoldProjectConfigResult = {
  created: string[];
  existing: string[];
  updated: string[];
  paths: {
    projectCommitted: string;
    projectLocal: string;
    gitignore: string;
  };
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_CONFIG: ResolvedTrailConfig = {
  sources: { defaultFilter: null },
  tui: { previewByteCap: 65_536, previewEventCap: 500 },
  keymap: {},
};

export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<ResolvedConfig> {
  const env = options.env ?? process.env;
  const projectRoot = options.projectRoot ?? process.cwd();
  const paths = configPaths(env, projectRoot);
  let config = cloneConfig(DEFAULT_CONFIG);
  const sources: ConfigSource[] = [{ layer: "built_in", path: null, status: "default" }];

  for (const source of [
    { layer: "user_global" as const, path: paths.user_global },
    { layer: "project_committed" as const, path: paths.project_committed },
    { layer: "project_local" as const, path: paths.project_local },
  ]) {
    if (source.path === null) {
      sources.push({ layer: source.layer, path: null, status: "missing" });
      continue;
    }
    const partial = await readConfigFile(source.path);
    if (partial === null) {
      sources.push({ layer: source.layer, path: source.path, status: "missing" });
      continue;
    }
    config = mergeConfig(config, partial);
    sources.push({ layer: source.layer, path: source.path, status: "loaded" });
  }

  return { config, sources };
}

export async function scaffoldProjectConfig(
  options: ScaffoldProjectConfigOptions = {},
): Promise<ScaffoldProjectConfigResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const configDir = join(projectRoot, ".agent-trail");
  const projectCommitted = join(configDir, "config.json");
  const projectLocal = join(configDir, "config.local.json");
  const gitignore = join(projectRoot, ".gitignore");
  const created: string[] = [];
  const existing: string[] = [];
  const updated: string[] = [];

  await mkdir(configDir, { recursive: true });
  await createFileIfMissing(projectCommitted, defaultConfigBytes(), created, existing);
  await createFileIfMissing(projectLocal, defaultConfigBytes(), created, existing);
  await ensureLocalConfigIgnored(gitignore, created, existing, updated);

  return {
    created,
    existing,
    updated,
    paths: { projectCommitted, projectLocal, gitignore },
  };
}

function configPaths(
  env: Env,
  projectRoot: string,
): Record<Exclude<ConfigLayer, "built_in">, string | null> {
  const home = env.HOME ?? env.USERPROFILE;
  return {
    user_global:
      home === undefined || home.length === 0
        ? null
        : join(home, ".config", "trail", "config.json"),
    project_committed: join(projectRoot, ".agent-trail", "config.json"),
    project_local: join(projectRoot, ".agent-trail", "config.local.json"),
  };
}

async function readConfigFile(path: string): Promise<TrailConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ConfigError(`config: ${path}: invalid JSON`);
  }
  return validateConfig(parsed, path);
}

function mergeConfig(base: ResolvedTrailConfig, next: TrailConfig): ResolvedTrailConfig {
  return {
    sources: {
      defaultFilter:
        next.sources !== undefined && hasOwn(next.sources, "defaultFilter")
          ? (next.sources.defaultFilter ?? null)
          : base.sources.defaultFilter,
    },
    tui: {
      previewByteCap: next.tui?.previewByteCap ?? base.tui.previewByteCap,
      previewEventCap: next.tui?.previewEventCap ?? base.tui.previewEventCap,
    },
    keymap: { ...base.keymap, ...(next.keymap ?? {}) },
  };
}

function validateConfig(value: unknown, path: string): TrailConfig {
  if (!isPlainObject(value)) {
    throw new ConfigError(`config: ${path}: config must be an object`);
  }
  assertKnownKeys(value, ["sources", "tui", "keymap"], path);
  const out: TrailConfig = {};

  if (hasOwn(value, "sources")) {
    if (!isPlainObject(value.sources)) {
      throw new ConfigError(`config: ${path}: sources must be an object`);
    }
    assertKnownKeys(value.sources, ["defaultFilter"], path, "sources");
    if (hasOwn(value.sources, "defaultFilter")) {
      const defaultFilter = value.sources.defaultFilter;
      if (defaultFilter !== null && typeof defaultFilter !== "string") {
        throw new ConfigError(`config: ${path}: sources.defaultFilter must be a string or null`);
      }
      out.sources = { defaultFilter };
    } else {
      out.sources = {};
    }
  }

  if (hasOwn(value, "tui")) {
    if (!isPlainObject(value.tui)) {
      throw new ConfigError(`config: ${path}: tui must be an object`);
    }
    assertKnownKeys(value.tui, ["previewByteCap", "previewEventCap"], path, "tui");
    out.tui = {};
    if (hasOwn(value.tui, "previewByteCap")) {
      out.tui.previewByteCap = positiveInteger(
        value.tui.previewByteCap,
        path,
        "tui.previewByteCap",
      );
    }
    if (hasOwn(value.tui, "previewEventCap")) {
      out.tui.previewEventCap = positiveInteger(
        value.tui.previewEventCap,
        path,
        "tui.previewEventCap",
      );
    }
  }

  if (hasOwn(value, "keymap")) {
    if (!isPlainObject(value.keymap)) {
      throw new ConfigError(`config: ${path}: keymap must be an object`);
    }
    out.keymap = value.keymap;
  }

  return out;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  known: readonly string[],
  path: string,
  prefix?: string,
): void {
  const allowed = new Set(known);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(
        `config: ${path}: unknown key: ${prefix === undefined ? key : `${prefix}.${key}`}`,
      );
    }
  }
}

function positiveInteger(value: unknown, path: string, key: string): number {
  if (Number.isInteger(value) && typeof value === "number" && value > 0) {
    return value;
  }
  throw new ConfigError(`config: ${path}: ${key} must be a positive integer`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(value, key);
}

function cloneConfig(config: ResolvedTrailConfig): ResolvedTrailConfig {
  return {
    sources: { ...config.sources },
    tui: { ...config.tui },
    keymap: { ...config.keymap },
  };
}

function defaultConfigBytes(): string {
  return `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`;
}

async function createFileIfMissing(
  path: string,
  bytes: string,
  created: string[],
  existing: string[],
): Promise<void> {
  try {
    await writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
    created.push(path);
  } catch (error) {
    if (isAlreadyExists(error)) {
      existing.push(path);
      return;
    }
    throw error;
  }
}

async function ensureLocalConfigIgnored(
  gitignore: string,
  created: string[],
  existing: string[],
  updated: string[],
): Promise<void> {
  const entry = ".agent-trail/config.local.json";
  let raw: string;
  try {
    raw = await readFile(gitignore, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await writeFile(gitignore, `${entry}\n`, "utf8");
    created.push(gitignore);
    return;
  }
  if (raw.split(/\r?\n/).includes(entry)) {
    existing.push(gitignore);
    return;
  }
  const prefix = raw.length === 0 || raw.endsWith("\n") ? raw : `${raw}\n`;
  await writeFile(gitignore, `${prefix}${entry}\n`, "utf8");
  updated.push(gitignore);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
