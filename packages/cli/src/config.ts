import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

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
  const realProjectRoot = await realpath(resolve(projectRoot));
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
    const partial = await readConfigFile(
      source.path,
      source.layer === "user_global"
        ? undefined
        : { projectRoot: realProjectRoot, displayPath: projectConfigDisplayPath(source.layer) },
    );
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
  const projectRoot = await realpath(resolve(options.projectRoot ?? process.cwd()));
  const configDir = join(projectRoot, ".agent-trail");
  const projectCommitted = join(configDir, "config.json");
  const projectLocal = join(configDir, "config.local.json");
  const gitignore = join(projectRoot, ".gitignore");
  const created: string[] = [];
  const existing: string[] = [];
  const updated: string[] = [];

  assertWithinRoot(projectRoot, configDir, ".agent-trail");
  assertWithinRoot(projectRoot, projectCommitted, ".agent-trail/config.json");
  assertWithinRoot(projectRoot, projectLocal, ".agent-trail/config.local.json");
  assertWithinRoot(projectRoot, gitignore, ".gitignore");

  await assertDirectoryTarget(configDir, ".agent-trail");
  await assertRegularFileTarget(gitignore, ".gitignore");
  await mkdir(configDir, { recursive: true });
  await createFileIfMissing(
    projectRoot,
    projectCommitted,
    ".agent-trail/config.json",
    sparseConfigBytes(),
    created,
    existing,
  );
  await createFileIfMissing(
    projectRoot,
    projectLocal,
    ".agent-trail/config.local.json",
    sparseConfigBytes(),
    created,
    existing,
  );
  await ensureLocalConfigIgnored(projectRoot, gitignore, created, existing, updated);

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

type ProjectConfigReadGuard = {
  projectRoot: string;
  displayPath: string;
};

async function readConfigFile(
  path: string,
  projectGuard?: ProjectConfigReadGuard,
): Promise<TrailConfig | null> {
  if (projectGuard !== undefined) {
    const present = await assertReadableProjectConfig(path, projectGuard);
    if (!present) return null;
  }
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

async function assertReadableProjectConfig(
  path: string,
  guard: ProjectConfigReadGuard,
): Promise<boolean> {
  const stats = await lstatOrNull(path);
  if (stats === null) return false;
  if (stats.isSymbolicLink()) {
    throw new ConfigError(`config: refusing to read through symlink: ${guard.displayPath}`);
  }
  if (!stats.isFile()) {
    throw new ConfigError(`config: ${guard.displayPath} must be a file`);
  }
  assertWithinRoot(guard.projectRoot, await realpath(path), guard.displayPath);
  return true;
}

function projectConfigDisplayPath(layer: Exclude<ConfigLayer, "built_in" | "user_global">): string {
  return layer === "project_committed"
    ? ".agent-trail/config.json"
    : ".agent-trail/config.local.json";
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

function sparseConfigBytes(): string {
  return "{}\n";
}

async function createFileIfMissing(
  projectRoot: string,
  path: string,
  displayPath: string,
  bytes: string,
  created: string[],
  existing: string[],
): Promise<void> {
  if (await writeNewFileSafely(projectRoot, path, displayPath, bytes)) {
    created.push(path);
    return;
  }
  await assertRegularFileTarget(path, displayPath);
  assertWithinRoot(projectRoot, await realpath(path), displayPath);
  existing.push(path);
}

async function ensureLocalConfigIgnored(
  projectRoot: string,
  gitignore: string,
  created: string[],
  existing: string[],
  updated: string[],
): Promise<void> {
  const entry = ".agent-trail/config.local.json";
  const handle = await openExistingFileSafely(projectRoot, gitignore, ".gitignore");
  if (handle === null) {
    if (await writeNewFileSafely(projectRoot, gitignore, ".gitignore", `${entry}\n`)) {
      created.push(gitignore);
      return;
    }
    return ensureLocalConfigIgnored(projectRoot, gitignore, created, existing, updated);
  }
  try {
    const raw = await handle.readFile("utf8");
    if (raw.split(/\r?\n/).includes(entry)) {
      existing.push(gitignore);
      return;
    }
    const prefix = raw.length === 0 || raw.endsWith("\n") ? raw : `${raw}\n`;
    await handle.truncate(0);
    await handle.write(`${prefix}${entry}\n`, 0, "utf8");
    updated.push(gitignore);
  } finally {
    await handle.close();
  }
}

async function writeNewFileSafely(
  projectRoot: string,
  path: string,
  displayPath: string,
  bytes: string,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o666,
    );
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    if (isSymlinkLoop(error)) {
      throw new ConfigError(`config: refusing to write through symlink: ${displayPath}`);
    }
    throw error;
  }
  try {
    await assertOpenFileMatchesPath(projectRoot, path, displayPath, handle);
    await handle.writeFile(bytes, "utf8");
    return true;
  } finally {
    await handle.close();
  }
}

async function openExistingFileSafely(
  projectRoot: string,
  path: string,
  displayPath: string,
): Promise<Awaited<ReturnType<typeof open>> | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNotFound(error)) return null;
    if (isSymlinkLoop(error)) {
      throw new ConfigError(`config: refusing to write through symlink: ${displayPath}`);
    }
    throw error;
  }
  try {
    await assertOpenFileMatchesPath(projectRoot, path, displayPath, handle);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertOpenFileMatchesPath(
  projectRoot: string,
  path: string,
  displayPath: string,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
  const opened = await handle.stat();
  if (!opened.isFile()) {
    throw new ConfigError(`config: ${displayPath} must be a file`);
  }
  const current = await stat(path);
  if (opened.dev !== current.dev || opened.ino !== current.ino) {
    throw new ConfigError(`config: target changed while opening: ${displayPath}`);
  }
  assertWithinRoot(projectRoot, await realpath(path), displayPath);
}

function assertWithinRoot(projectRoot: string, path: string, displayPath: string): void {
  const rel = relative(projectRoot, path);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new ConfigError(`config: refusing to write outside project root: ${displayPath}`);
}

async function assertDirectoryTarget(path: string, displayPath: string): Promise<void> {
  const stats = await lstatOrNull(path);
  if (stats === null) return;
  if (stats.isSymbolicLink()) {
    throw new ConfigError(`config: refusing to write through symlink: ${displayPath}`);
  }
  if (!stats.isDirectory()) {
    throw new ConfigError(`config: ${displayPath} must be a directory`);
  }
}

async function assertRegularFileTarget(path: string, displayPath: string): Promise<void> {
  const stats = await lstatOrNull(path);
  if (stats === null) return;
  if (stats.isSymbolicLink()) {
    throw new ConfigError(`config: refusing to write through symlink: ${displayPath}`);
  }
  if (!stats.isFile()) {
    throw new ConfigError(`config: ${displayPath} must be a file`);
  }
}

async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Record<string, unknown>).code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Record<string, unknown>).code === "EEXIST"
  );
}

function isSymlinkLoop(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Record<string, unknown>).code === "ELOOP"
  );
}
