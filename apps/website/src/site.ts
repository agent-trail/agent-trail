import MarkdownIt from "markdown-it";

export const CURRENT_SPEC_VERSION = "0.1.0";
export const GITHUB_URL = "https://github.com/agent-trail/agent-trail";

export type ReadText = (path: string) => Promise<string>;

export type LandingLink = {
  href: string;
  label: string;
};

export type ReferenceImplementation = {
  name: string;
  packageLabel: string;
  status: "available" | "planned";
  href: string;
};

export type LandingPageModel = {
  title: string;
  hook: string;
  summary: string;
  codePreview: string;
  primaryLinks: LandingLink[];
  referenceImplementations: ReferenceImplementation[];
};

export type ContentOptions = {
  readText: ReadText;
};

export type SpecPageModel = {
  version: typeof CURRENT_SPEC_VERSION;
  routeVersion: `v${typeof CURRENT_SPEC_VERSION}` | "latest";
  status: "Draft";
  license: "Apache-2.0";
  html: string;
  sections: SpecSection[];
  glossaryTerms: GlossaryTerm[];
  sampleBlocks: SpecSampleBlock[];
};

export type SpecSection = {
  id: string;
  title: string;
  level: number;
  index: number;
};

export type GlossaryTerm = {
  term: string;
  definition: string;
};

export type SpecSampleBlock = {
  id: string;
  title: string;
  sectionIds: string[];
  lines: string[];
  highlightLinesBySectionId: Record<string, number[]>;
};

export type SchemaResponse = {
  routeVersion: `v${typeof CURRENT_SPEC_VERSION}` | "latest";
  contentType: "application/schema+json";
  body: string;
};

export type ViewerShellModel = {
  title: "Trail viewer shell";
  status: "coming later";
  gistId: string;
  body: string;
};

const HOMEPAGE_SUMMARY =
  "Agent Trail turns a coding-agent session into a durable JSONL artifact: readable, streamable, versionable, and shareable across implementations.";

const CODE_PREVIEW = [
  '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","ts":"2026-06-06T11:42:00.000Z","agent":{"name":"codex-cli"}}',
  '{"type":"user_message","id":"01HEVT00000000000000000001","ts":"2026-06-06T11:42:05.000Z","payload":{"text":"Add README.md"}}',
  '{"type":"agent_message","id":"01HEVT00000000000000000002","ts":"2026-06-06T11:42:08.000Z","payload":{"text":"Writing overview."}}',
  '{"type":"tool_call","id":"01HEVT00000000000000000003","ts":"2026-06-06T11:42:10.000Z","payload":{"tool":"file_edit","args":{"path":"README.md"}}}',
  '{"type":"tool_result","id":"01HEVT00000000000000000004","ts":"2026-06-06T11:42:11.000Z","payload":{"for_id":"01HEVT00000000000000000003","ok":true}}',
  '{"type":"session_summary","id":"01HEVT00000000000000000005","ts":"2026-06-06T11:42:12.000Z","payload":{"text":"README added with project usage."}}',
  '{"type":"tool_call","id":"01HEVT00000000000000000006","ts":"2026-06-06T11:42:13.000Z","payload":{"tool":"shell_command","args":{"command":"git diff -- README.md"}}}',
  '{"type":"tool_result","id":"01HEVT00000000000000000007","ts":"2026-06-06T11:42:14.000Z","payload":{"for_id":"01HEVT00000000000000000006","ok":true,"bytes":1842}}',
  '{"type":"agent_message","id":"01HEVT00000000000000000008","ts":"2026-06-06T11:42:16.000Z","payload":{"text":"Validated the generated trail."}}',
  '{"type":"session_end","id":"01HEVT00000000000000000009","ts":"2026-06-06T11:42:18.000Z","payload":{"status":"complete"}}',
].join("\n");

const PRIMARY_LINKS: LandingLink[] = [
  { href: "/spec/latest", label: "Read spec" },
  { href: "/schema/latest.json", label: "View schema" },
];

const REFERENCE_IMPLEMENTATIONS: ReferenceImplementation[] = [
  {
    name: "Node SDK",
    packageLabel: "@agent-trail/core",
    status: "available",
    href: `${GITHUB_URL}/tree/main/packages/core`,
  },
  {
    name: "CLI",
    packageLabel: "trail",
    status: "available",
    href: `${GITHUB_URL}/tree/main/packages/cli`,
  },
  {
    name: "MCP",
    packageLabel: "@agent-trail/mcp",
    status: "planned",
    href: `${GITHUB_URL}/issues?q=is%3Aissue%20mcp`,
  },
  {
    name: "Skills",
    packageLabel: "#63 #64 #67 #68",
    status: "planned",
    href: `${GITHUB_URL}/issues?q=is%3Aissue%20%2363%20OR%20%2364%20OR%20%2367%20OR%20%2368`,
  },
  {
    name: "Gist viewer",
    packageLabel: "/view/gist/:gistId",
    status: "available",
    href: `${GITHUB_URL}/issues/30`,
  },
];

export async function buildLandingPageModel(_opts: ContentOptions): Promise<LandingPageModel> {
  return {
    title: "Agent Trail",
    hook: "open format for coding agent sessions",
    summary: HOMEPAGE_SUMMARY,
    codePreview: CODE_PREVIEW,
    primaryLinks: PRIMARY_LINKS,
    referenceImplementations: REFERENCE_IMPLEMENTATIONS,
  };
}

export async function buildSchemaResponse(
  opts: ContentOptions & { routeVersion: `v${typeof CURRENT_SPEC_VERSION}` | "latest" },
): Promise<SchemaResponse> {
  return {
    routeVersion: opts.routeVersion,
    contentType: "application/schema+json",
    body: await opts.readText("schema.json"),
  };
}

export async function buildSpecPageModel(
  opts: ContentOptions & { routeVersion: `v${typeof CURRENT_SPEC_VERSION}` | "latest" },
): Promise<SpecPageModel> {
  const markdown = await opts.readText("spec.md");
  const sections = parseSpecSections(markdown);
  return {
    version: CURRENT_SPEC_VERSION,
    routeVersion: opts.routeVersion,
    status: "Draft",
    license: "Apache-2.0",
    html: await renderMarkdown(stripDocumentHeader(markdown)),
    sections,
    glossaryTerms: parseGlossaryTerms(markdown),
    sampleBlocks: buildSpecSampleBlocks(sections),
  };
}

export function buildViewerShellModel({ gistId }: { gistId: string }): ViewerShellModel {
  return {
    title: "Trail viewer shell",
    status: "coming later",
    gistId,
    body: `Viewer route shell for gist ${gistId}. Shared trail loading lands in the follow-up viewer issues.`,
  };
}

let markdownRenderer: Promise<MarkdownIt> | undefined;

function renderer(): Promise<MarkdownIt> {
  markdownRenderer ??= createRenderer();
  return markdownRenderer;
}

async function createRenderer(): Promise<MarkdownIt> {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });

  const defaultHeadingOpen =
    md.renderer.rules.heading_open ??
    ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  const defaultHeadingClose =
    md.renderer.rules.heading_close ??
    ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const title = titleOf(tokens[index + 1]);
    const slug = uniqueHeadingSlug(env, title);
    const token = tokens[index];
    if (token === undefined) {
      return defaultHeadingOpen(tokens, index, options, env, self);
    }

    token.attrSet("id", slug);
    const inlineToken = tokens[index + 1];
    stripHeadingNumber(inlineToken);
    return `${defaultHeadingOpen(tokens, index, options, env, self)}<a class="heading-id-anchor" href="#${slug}" aria-label="Link to ${escapeAttribute(
      title,
    )}">// ID: ${escapeHtml(sectionLabelOf(env, title, token.tag))}</a>`;
  };

  md.renderer.rules.heading_close = (tokens, index, options, env, self) => {
    popHeadingSlug(env);
    return defaultHeadingClose(tokens, index, options, env, self);
  };

  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token === undefined) return defaultFence(tokens, index, options, env, self);

    const language = token?.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (language !== "json" && language !== "jsonl") {
      return defaultFence(tokens, index, options, env, self);
    }

    const code = renderJsonCodeHtml(token.content);
    return `<pre><code class="language-${escapeAttribute(language)}">${code}</code></pre>\n`;
  };

  return md;
}

async function renderMarkdown(markdown: string): Promise<string> {
  return (await renderer()).render(markdown, {});
}

function stripDocumentHeader(markdown: string): string {
  if (!markdown.startsWith("# ")) return markdown;

  const firstRule = markdown.indexOf("\n---");
  if (firstRule === -1) return markdown;

  const afterRule = markdown.indexOf("\n", firstRule + 4);
  return markdown.slice(afterRule === -1 ? firstRule + 4 : afterRule + 1).trimStart();
}

function titleOf(token: { content?: string } | undefined): string {
  return token?.content ?? "section";
}

function sectionLabelOf(env: unknown, title: string, tag: string | undefined): string {
  const numbered = /^(\d+(?:\.\d+)*)/.exec(title);
  const state = headingStateOf(env);
  if (numbered?.[1] !== undefined) {
    const explicitCounters = numbered[1].split(".").map((part) => Number.parseInt(part, 10));
    if (shouldUseGeneratedLabelForExplicitCounter(state.counters, explicitCounters)) {
      state.counters = nextCountersAtDepth(state.counters, explicitCounters.length);
      return state.counters.join(".");
    }

    state.counters = explicitCounters;
    return state.counters.join(".");
  }

  const level = Number.parseInt(tag?.replace(/^h/, "") ?? "", 10);
  if (Number.isFinite(level) && level >= 2) {
    const depth = level - 1;
    state.counters = nextCountersAtDepth(state.counters, depth);
    return state.counters.join(".");
  }

  return slugify(title).replace(/-/g, "_").toUpperCase();
}

function shouldUseGeneratedLabelForExplicitCounter(
  currentCounters: number[],
  explicitCounters: number[],
): boolean {
  const depth = explicitCounters.length;
  if (depth === 0 || currentCounters.length < depth) return false;
  const parentMatches = explicitCounters
    .slice(0, -1)
    .every((part, index) => currentCounters[index] === part);
  return parentMatches && (explicitCounters.at(-1) ?? 0) <= (currentCounters[depth - 1] ?? 0);
}

function nextCountersAtDepth(counters: number[], depth: number): number[] {
  const next = counters.slice(0, depth);
  while (next.length < depth) next.push(0);
  next[depth - 1] = (next[depth - 1] ?? 0) + 1;
  return next;
}

function headingStateOf(env: unknown): { counters: number[] } {
  const stateEnv = env as { headingState?: { counters: number[] } };
  stateEnv.headingState ??= { counters: [] };
  return stateEnv.headingState;
}

function stripHeadingNumber(
  token: { children?: { content?: string; type?: string }[] | null; content?: string } | undefined,
) {
  if (token === undefined) return;
  token.content = token.content?.replace(/^\d+(?:\.\d+)*\.?\s+/, "") ?? token.content;
  const textChild = token.children?.find((child) => child.type === "text");
  if (textChild !== undefined) {
    textChild.content = textChild.content?.replace(/^\d+(?:\.\d+)*\.?\s+/, "") ?? textChild.content;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderJsonCodeHtml(value: string): string {
  return escapeHtml(value).replace(/(&quot;[^&]+?&quot;)(\s*:)/g, (_match, key, colon) => {
    return `<span class="code-syntax-key">${key}</span><span class="code-syntax-punctuation">${colon}</span>`;
  });
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function parseSpecSections(markdown: string): SpecSection[] {
  const sections: SpecSection[] = [];
  const seen = new Map<string, number>();

  for (const line of markdown.split("\n")) {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (match === null) continue;

    const title = match[2]?.replace(/\s+#$/, "").trim() ?? "Section";
    const baseId = slugify(title);
    const seenCount = seen.get(baseId) ?? 0;
    seen.set(baseId, seenCount + 1);

    sections.push({
      id: seenCount === 0 ? baseId : `${baseId}-${seenCount + 1}`,
      title,
      level: match[1]?.length ?? 1,
      index: sections.length,
    });
  }

  return sections;
}

function parseGlossaryTerms(markdown: string): GlossaryTerm[] {
  const terminologyStart = markdown.indexOf("## 4. Terminology");
  if (terminologyStart === -1) return [];

  const nextSection = markdown.indexOf("\n## 5.", terminologyStart);
  const terminology = markdown.slice(
    terminologyStart,
    nextSection === -1 ? undefined : nextSection,
  );

  return terminology
    .split("\n")
    .map((line) => {
      const match = /^\|\s+\*\*(.+?)\*\*\s+\|\s+(.+?)\s+\|$/.exec(line);
      if (match === null) return undefined;
      return {
        term: stripMarkdown(match[1] ?? ""),
        definition: stripMarkdown(match[2] ?? ""),
      };
    })
    .filter((term): term is GlossaryTerm => term !== undefined);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueHeadingSlug(env: unknown, title: string): string {
  const renderEnv = env as {
    headingSlugCounts?: Map<string, number>;
    headingSlugStack?: string[];
  };
  renderEnv.headingSlugCounts ??= new Map<string, number>();
  renderEnv.headingSlugStack ??= [];

  const baseId = slugify(title);
  const seenCount = renderEnv.headingSlugCounts.get(baseId) ?? 0;
  renderEnv.headingSlugCounts.set(baseId, seenCount + 1);
  const slug = seenCount === 0 ? baseId : `${baseId}-${seenCount + 1}`;
  renderEnv.headingSlugStack.push(slug);
  return slug;
}

function popHeadingSlug(env: unknown): string | undefined {
  const renderEnv = env as { headingSlugStack?: string[] };
  return renderEnv.headingSlugStack?.pop();
}

function buildSpecSampleBlocks(sections: SpecSection[]): SpecSampleBlock[] {
  const excludedSampleSectionIds = new Set([
    "17-formal-schema",
    "18-examples",
    "changelog",
    "appendix-a-minimal-valid-record",
    "license",
  ]);
  const mainSections = sections.filter(
    (section) =>
      (section.index === 0 || section.level === 2) && !excludedSampleSectionIds.has(section.id),
  );

  return mainSections.map((mainSection) => {
    const sectionIds = sectionIdsForMainSection(sections, mainSection);
    return {
      id: `sample-${mainSection.id}`,
      title: sampleTitleForMainSection(mainSection.title),
      sectionIds,
      lines: sampleLinesForMainSection(mainSection.id),
      highlightLinesBySectionId: Object.fromEntries(
        sectionIds.map((sectionId) => [
          sectionId,
          highlightLinesForSection(sectionId, mainSection.id),
        ]),
      ),
    };
  });
}

const sampleIds = new Map<string, string>();

function trailLine(type: string, id: string, rest: Record<string, unknown>): string {
  return JSON.stringify(
    normalizeSampleRecord({
      type,
      id: sampleId(id),
      ...(rewriteSampleRefs(rest) as Record<string, unknown>),
    }),
  );
}

function sampleId(seed: string): string {
  const existing = sampleIds.get(seed);
  if (existing !== undefined) return existing;
  const next = `00000000-0000-4000-8000-${String(sampleIds.size + 1).padStart(12, "0")}`;
  sampleIds.set(seed, next);
  return next;
}

function rewriteSampleRefs(value: unknown): unknown {
  if (typeof value === "string" && looksLikeLegacySampleId(value)) return sampleId(value);
  if (Array.isArray(value)) return value.map((item) => rewriteSampleRefs(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteSampleRefs(entry)]),
    );
  }
  return value;
}

function looksLikeLegacySampleId(value: string): boolean {
  return value.startsWith("01H") || /^00000000-0000-0000-0000-000000000\d{3}$/.test(value);
}

function normalizeSampleRecord(record: Record<string, unknown>): Record<string, unknown> {
  if (record.type === "trail") {
    delete record.content_hash;
    const sessions = record.sessions;
    if (Array.isArray(sessions)) {
      record.sessions = sessions.map((session) => {
        if (session === null || typeof session !== "object") return session;
        const entry = session as Record<string, unknown>;
        return {
          id: entry.id,
          agent: typeof entry.agent === "string" ? entry.agent : "codex-cli",
        };
      });
    }
  }

  if (record.type === "session") {
    delete record.content_hash;
    const agent = record.agent as Record<string, unknown> | undefined;
    if (agent?.name === "trail-cli") agent.name = "codex-cli";
    const forkFrom = record.fork_from as Record<string, unknown> | undefined;
    if (forkFrom !== undefined) {
      if (forkFrom.session_id === undefined) forkFrom.session_id = sampleId("sample-fork-parent");
      delete forkFrom.content_hash;
    }
    const redactedFrom = record.redacted_from as Record<string, unknown> | undefined;
    if (redactedFrom !== undefined) delete record.redacted_from;
  }

  if (record.type === "session_metadata_update") {
    const payload = record.payload as Record<string, unknown> | undefined;
    if (typeof payload?.cwd === "string") {
      record.payload = {
        field: "x-agent-trail/cwd",
        value: payload.cwd,
        reason: "runtime_inferred",
      };
    }
    if (payload?.agent !== undefined) {
      record.payload = {
        field: "agent.model_default",
        value: "claude-sonnet-4-5",
        reason: "runtime_inferred",
      };
    }
  }

  if (record.type === "session_summary") {
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload !== undefined && payload.scope === undefined) {
      record.payload = { scope: "session", ...payload };
    }
  }

  if (record.type === "task_plan_update") {
    const payload = record.payload as Record<string, unknown> | undefined;
    const tasks = payload?.tasks;
    if (payload !== undefined && Array.isArray(tasks)) {
      record.payload = {
        ...payload,
        items: tasks.map((task) => {
          if (task === null || typeof task !== "object") return task;
          const entry = task as Record<string, unknown>;
          return {
            id: entry.id,
            content: entry.title ?? entry.content,
            status: entry.status,
          };
        }),
      };
      delete (record.payload as Record<string, unknown>).tasks;
    }
  }

  if (record.type === "tool_call") {
    const payload = record.payload as Record<string, unknown> | undefined;
    const args = payload?.args as Record<string, unknown> | undefined;
    if (payload?.tool === "file_edit" && args?.diff === undefined) {
      payload.args = { path: args?.path, diff: "diff omitted for compact sample" };
    }
  }

  if (record.type === "tool_result") {
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload?.content_hash !== undefined) {
      payload.output = `content_hash ${payload.content_hash}`;
      delete payload.content_hash;
    }
    if (payload?.truncated === true && payload.output_size === undefined) {
      payload.output_size = payload.original_bytes ?? 0;
    }
    delete payload?.original_bytes;
  }

  if (record.type === "system_event") {
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload?.kind === "capability_change") {
      record.type = "capability_change";
      record.payload = {
        scope: "tool",
        reason: "registered",
        added: Array.isArray(payload.capabilities)
          ? payload.capabilities.map((capability) => ({ name: String(capability) }))
          : [],
      };
      return record;
    }
    if (payload?.kind === "diagnostic") {
      record.payload = {
        kind: payload.severity === "warning" ? "agent_warning" : "task_completed",
        data: { code: payload.code },
      };
    }
  }

  return record;
}

function sectionIdsForMainSection(sections: SpecSection[], mainSection: SpecSection): string[] {
  if (mainSection.level <= 1) return [mainSection.id];

  const startIndex = sections.findIndex((section) => section.id === mainSection.id);
  if (startIndex === -1) return [mainSection.id];

  const nextMainIndex = sections.findIndex(
    (section) => section.index > mainSection.index && section.level <= mainSection.level,
  );
  return sections
    .slice(startIndex, nextMainIndex === -1 ? undefined : nextMainIndex)
    .map((section) => section.id);
}

function sampleTitleForMainSection(title: string): string {
  return stripMarkdown(title).replace(/^\d+(?:\.\d+)*\.?\s+/, "") || "Spec sample";
}

function sampleLinesForMainSection(mainSectionId: string): string[] {
  switch (mainSectionId) {
    case "agent-trail-specification":
    case "1-motivation":
      return motivationSampleLines();
    case "2-goals-and-non-goals":
      return goalsSampleLines();
    case "3-at-a-glance":
      return atAGlanceSampleLines();
    case "4-terminology":
      return terminologySampleLines();
    case "5-file-format":
      return fileFormatSampleLines();
    case "6-versioning":
      return versioningSampleLines();
    case "7-identity-artifacts-and-content-addressing":
      return identitySampleLines();
    case "8-0-the-trail-envelope":
      return trailEnvelopeSampleLines();
    case "8-the-session-header":
      return sessionHeaderSampleLines();
    case "9-events":
      return eventsSampleLines();
    case "10-canonical-tool-taxonomy":
      return toolTaxonomySampleLines();
    case "11-vendor-extensions":
      return vendorExtensionsSampleLines();
    case "12-tree-and-branching":
      return treeBranchingSampleLines();
    case "13-canonical-agent-registry":
      return agentRegistrySampleLines();
    case "14-truncation-overflow-and-raw-source-size":
      return truncationSampleLines();
    case "15-redaction":
      return redactionSampleLines();
    case "16-validation":
      return validationSampleLines();
    default:
      return minimalSampleLines();
  }
}

const SAMPLE_SESSION_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SAMPLE_FILE_HASH = "5f70bf18a086007016b156d84743f11bc7b1b75640f7a1a21d3f8f720691d2af";
const SAMPLE_REDACTED_HASH = "89f0f9c6a6b1082d3d25c65ebed31f6bdf04c55d40a093e3b8dcfb6d9f2c1190";

function motivationSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSMOTIVATION000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTMOTIVATION00000000001", {
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "Move this debugging session into a format Pi can inspect." },
    }),
    trailLine("agent_message", "01HEVTMOTIVATION00000000002", {
      ts: "2026-05-17T14:00:09.000Z",
      payload: { text: "Agent Trail records the shared session shape, not the source UI." },
    }),
    trailLine("tool_call", "01HEVTMOTIVATION00000000003", {
      ts: "2026-05-17T14:00:12.000Z",
      payload: { tool: "file_edit", args: { path: "README.md", operation: "update" } },
    }),
    trailLine("tool_result", "01HEVTMOTIVATION00000000004", {
      ts: "2026-05-17T14:00:13.000Z",
      payload: { for_id: "01HEVTMOTIVATION00000000003", ok: true, output: "README.md updated" },
    }),
    trailLine("session_summary", "01HEVTMOTIVATION00000000005", {
      ts: "2026-05-17T14:00:16.000Z",
      payload: { text: "Session continuity survives the source agent boundary." },
    }),
  ];
}

function goalsSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSGOALS000000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T14:10:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTGOALS00000000000001", {
      ts: "2026-05-17T14:10:03.000Z",
      payload: { text: "Validate that this exported session is readable by another tool." },
    }),
    trailLine("agent_message", "01HEVTGOALS00000000000002", {
      ts: "2026-05-17T14:10:06.000Z",
      payload: { text: "Using the canonical event vocabulary: messages, tools, results, summary." },
    }),
    trailLine("tool_call", "01HEVTGOALS00000000000003", {
      ts: "2026-05-17T14:10:08.000Z",
      payload: { tool: "shell_command", args: { command: "trail validate session.trail.jsonl" } },
    }),
    trailLine("tool_result", "01HEVTGOALS00000000000004", {
      ts: "2026-05-17T14:10:10.000Z",
      payload: { for_id: "01HEVTGOALS00000000000003", ok: true, output: "schema ok; graph ok" },
    }),
    trailLine("session_summary", "01HEVTGOALS00000000000005", {
      ts: "2026-05-17T14:10:12.000Z",
      payload: { text: "Portable, searchable, line-by-line, and versionable." },
    }),
  ];
}

function atAGlanceSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSGLANCE00000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTGLANCE0000000000001", {
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
    trailLine("agent_message", "01HEVTGLANCE0000000000002", {
      ts: "2026-05-17T14:00:07.000Z",
      payload: { text: "hi" },
    }),
    trailLine("user_message", "01HEVTGLANCE0000000000003", {
      ts: "2026-05-17T14:00:10.000Z",
      payload: { text: "Can this keep going line by line?" },
    }),
    trailLine("agent_message", "01HEVTGLANCE0000000000004", {
      ts: "2026-05-17T14:00:12.000Z",
      payload: { text: "Yes. Each later line remains another self-contained event." },
    }),
    trailLine("session_summary", "01HEVTGLANCE0000000000005", {
      ts: "2026-05-17T14:00:14.000Z",
      payload: { text: "A session header plus event lines forms the basic trail shape." },
    }),
  ];
}

function terminologySampleLines(): string[] {
  return [
    trailLine("trail", "00000000-0000-0000-0000-000000000101", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T15:10:00.000Z",
      name: "shared-review",
      producer: "trail-cli/0.3.0",
      content_hash: SAMPLE_FILE_HASH,
    }),
    trailLine("session", "01HSESSTERMS000000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T15:10:01.000Z",
      content_hash: SAMPLE_SESSION_HASH,
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTTERMS00000000000001", {
      ts: "2026-05-17T15:10:04.000Z",
      payload: { text: "Explain trail envelope, session group, and event." },
    }),
    trailLine("agent_message", "01HEVTTERMS00000000000002", {
      ts: "2026-05-17T15:10:07.000Z",
      payload: {
        text: "The envelope wraps the file; the session header starts the group; this line is an event.",
      },
    }),
    trailLine("session_summary", "01HEVTTERMS00000000000003", {
      ts: "2026-05-17T15:10:11.000Z",
      payload: {
        text: "A session group is the header plus following events until the next header or EOF.",
      },
    }),
    trailLine("system_event", "01HEVTTERMS00000000000004", {
      ts: "2026-05-17T15:10:12.000Z",
      payload: { kind: "diagnostic", severity: "info", code: "terminology_demo" },
    }),
  ];
}

function fileFormatSampleLines(): string[] {
  return [
    trailLine("trail", "00000000-0000-0000-0000-000000000201", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T15:20:00.000Z",
      producer: "trail-cli/0.3.0",
      name: "format-demo.trail.jsonl",
    }),
    trailLine("session", "01HSESSFORMAT0000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T15:20:01.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTFORMAT000000000001", {
      ts: "2026-05-17T15:20:03.000Z",
      payload: { text: "Each line is one complete JSON object." },
    }),
    trailLine("agent_message", "01HEVTFORMAT000000000002", {
      ts: "2026-05-17T15:20:05.000Z",
      payload: { text: "The file is UTF-8 JSONL with LF line endings." },
    }),
    trailLine("tool_call", "01HEVTFORMAT000000000003", {
      ts: "2026-05-17T15:20:07.000Z",
      payload: { tool: "shell_command", args: { command: "wc -l format-demo.trail.jsonl" } },
    }),
    trailLine("tool_result", "01HEVTFORMAT000000000004", {
      ts: "2026-05-17T15:20:08.000Z",
      payload: {
        for_id: "01HEVTFORMAT000000000003",
        ok: true,
        output: "6 format-demo.trail.jsonl",
      },
    }),
  ];
}

function versioningSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSVERSION000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T15:30:00.000Z",
      agent: { name: "trail-cli", version: "0.3.0" },
    }),
    trailLine("agent_message", "01HEVTVERSION00000000001", {
      ts: "2026-05-17T15:30:02.000Z",
      payload: { text: "Writer-strict output emits schema_version 0.1.0 exactly." },
    }),
    trailLine("system_event", "01HEVTVERSION00000000002", {
      ts: "2026-05-17T15:30:03.000Z",
      payload: { kind: "diagnostic", severity: "info", code: "reader_tolerance_runtime_only" },
    }),
    trailLine("session_summary", "01HEVTVERSION00000000003", {
      ts: "2026-05-17T15:30:05.000Z",
      payload: { text: "Package versions and spec versions stay separate." },
    }),
    trailLine("tool_call", "01HEVTVERSION00000000004", {
      ts: "2026-05-17T15:30:07.000Z",
      payload: {
        tool: "shell_command",
        args: { command: "trail validate --spec 0.1.0 session.trail.jsonl" },
      },
    }),
    trailLine("tool_result", "01HEVTVERSION00000000005", {
      ts: "2026-05-17T15:30:08.000Z",
      payload: {
        for_id: "01HEVTVERSION00000000004",
        ok: true,
        output: "schema_version 0.1.0 accepted",
      },
    }),
  ];
}

function identitySampleLines(): string[] {
  return [
    trailLine("session", "01HSESSIDENTITY00000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T18:00:01.000Z",
      content_hash: SAMPLE_SESSION_HASH,
      fork_from: {
        content_hash: "4f9f2cab0a4d8a4f9b4ef0cf392de5c9fd27f970e1edafc8e3185f557bb5ac43",
      },
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTIDENTITY00000000001", {
      ts: "2026-05-17T18:00:05.000Z",
      payload: { text: "Continue the earlier review without reusing its session id." },
    }),
    trailLine("agent_message", "01HEVTIDENTITY00000000002", {
      ts: "2026-05-17T18:00:08.000Z",
      payload: { text: "Lineage uses content_hash; this session keeps its own id." },
    }),
    trailLine("session_summary", "01HEVTIDENTITY00000000003", {
      ts: "2026-05-17T18:00:12.000Z",
      payload: { text: "Identity, artifact class, and hash provenance remain separate." },
    }),
    trailLine("tool_call", "01HEVTIDENTITY00000000004", {
      ts: "2026-05-17T18:00:14.000Z",
      payload: { tool: "shell_command", args: { command: "trail hash session.trail.jsonl" } },
    }),
    trailLine("tool_result", "01HEVTIDENTITY00000000005", {
      ts: "2026-05-17T18:00:15.000Z",
      payload: { for_id: "01HEVTIDENTITY00000000004", ok: true, content_hash: SAMPLE_SESSION_HASH },
    }),
  ];
}

function trailEnvelopeSampleLines(): string[] {
  return [
    trailLine("trail", "00000000-0000-0000-0000-000000000301", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T18:10:00.000Z",
      producer: "trail-cli/0.3.0",
      name: "team-review.trail.jsonl",
      content_hash: SAMPLE_FILE_HASH,
      sessions: [{ id: "01HSESSENVELOPE0000000001", content_hash: SAMPLE_SESSION_HASH }],
    }),
    trailLine("session", "01HSESSENVELOPE0000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T18:10:01.000Z",
      content_hash: SAMPLE_SESSION_HASH,
      agent: { name: "codex-cli" },
    }),
    trailLine("agent_message", "01HEVTENVELOPE0000000001", {
      ts: "2026-05-17T18:10:05.000Z",
      payload: { text: "The envelope is file metadata; it is not part of the event graph." },
    }),
    trailLine("user_message", "01HEVTENVELOPE0000000002", {
      ts: "2026-05-17T18:10:08.000Z",
      payload: { text: "Can the manifest list the session hash?" },
    }),
    trailLine("agent_message", "01HEVTENVELOPE0000000003", {
      ts: "2026-05-17T18:10:10.000Z",
      payload: { text: "Yes. The envelope can carry a sessions manifest for file-level readers." },
    }),
    trailLine("session_summary", "01HEVTENVELOPE0000000004", {
      ts: "2026-05-17T18:10:12.000Z",
      payload: { text: "Envelope metadata stays outside the session event graph." },
    }),
  ];
}

function sessionHeaderSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSHEADER000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T18:20:00.000Z",
      content_hash: SAMPLE_SESSION_HASH,
      agent: { name: "claude-code", version: "2.1.42", model_default: "claude-sonnet-4-5" },
      cwd: "/repo/agent-trail",
      vcs: { type: "git", revision: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" },
    }),
    trailLine("session_metadata_update", "01HEVTHEADER00000000001", {
      ts: "2026-05-17T18:20:04.000Z",
      payload: { cwd: "/repo/agent-trail/apps/website" },
    }),
    trailLine("agent_message", "01HEVTHEADER00000000002", {
      ts: "2026-05-17T18:20:06.000Z",
      payload: { text: "Mutable context changes are replayed as events, not header edits." },
    }),
    trailLine("user_message", "01HEVTHEADER00000000003", {
      ts: "2026-05-17T18:20:08.000Z",
      payload: { text: "Keep the original working directory visible too." },
    }),
    trailLine("agent_message", "01HEVTHEADER00000000004", {
      ts: "2026-05-17T18:20:10.000Z",
      payload: {
        text: "The header keeps the initial cwd; metadata updates capture later movement.",
      },
    }),
    trailLine("session_summary", "01HEVTHEADER00000000005", {
      ts: "2026-05-17T18:20:12.000Z",
      payload: { text: "Header fields describe session start state." },
    }),
  ];
}

function eventsSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSEVENTS000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T20:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTEVENTS000000000001", {
      ts: "2026-05-17T20:00:04.000Z",
      payload: { text: "Show the current diff." },
    }),
    trailLine("task_plan_update", "01HEVTEVENTS000000000002", {
      ts: "2026-05-17T20:00:05.000Z",
      payload: { tasks: [{ id: "audit", title: "Audit sample mapping", status: "in_progress" }] },
    }),
    trailLine("tool_call", "01HEVTEVENTS000000000003", {
      ts: "2026-05-17T20:00:06.000Z",
      payload: { tool: "shell_command", args: { command: "git diff --stat" } },
    }),
    trailLine("tool_result", "01HEVTEVENTS000000000004", {
      ts: "2026-05-17T20:00:07.000Z",
      payload: {
        for_id: "01HEVTEVENTS000000000003",
        ok: true,
        output: "apps/website/src/site.ts | 220 +++++++++",
      },
    }),
    trailLine("session_summary", "01HEVTEVENTS000000000005", {
      ts: "2026-05-17T20:00:10.000Z",
      payload: { text: "Messages, plans, tool calls, results, and summaries are explicit events." },
    }),
  ];
}

function toolTaxonomySampleLines(): string[] {
  return [
    trailLine("session", "01HSESSTOOLS0000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T20:20:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("tool_call", "01HEVTTOOLS0000000000001", {
      ts: "2026-05-17T20:20:03.000Z",
      payload: {
        tool: "file_edit",
        args: { path: "apps/website/src/site.ts", operation: "update" },
      },
    }),
    trailLine("tool_result", "01HEVTTOOLS0000000000002", {
      ts: "2026-05-17T20:20:04.000Z",
      payload: { for_id: "01HEVTTOOLS0000000000001", ok: true, output: "sample mapping updated" },
    }),
    trailLine("tool_call", "01HEVTTOOLS0000000000003", {
      ts: "2026-05-17T20:20:06.000Z",
      payload: {
        tool: "mcp_call",
        args: {
          server: "linear",
          tool: "list_issues",
          args: { project: "agent-trail" },
          headers: { Authorization: "[REDACTED]" },
        },
      },
    }),
    trailLine("tool_result", "01HEVTTOOLS0000000000004", {
      ts: "2026-05-17T20:20:07.000Z",
      payload: {
        for_id: "01HEVTTOOLS0000000000003",
        ok: true,
        output: '[{"id":"AT-29","title":"Website shell"}]',
      },
    }),
    trailLine("session_summary", "01HEVTTOOLS0000000000005", {
      ts: "2026-05-17T20:20:09.000Z",
      payload: {
        text: "Canonical tool labels preserve intent without source-agent-specific names.",
      },
    }),
  ];
}

function vendorExtensionsSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSVENDOR000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-18T08:00:00.000Z",
      agent: { name: "x-com-example-agent" },
      meta: { "com.example/build_id": "build-2026-05-18.1" },
    }),
    trailLine("system_event", "01HEVTVENDOR000000000001", {
      ts: "2026-05-18T08:00:02.000Z",
      payload: { kind: "capability_change", capabilities: ["shell_command", "file_edit"] },
      meta: { "x-example/checkpoint_id": "ckpt-017" },
    }),
    trailLine("agent_message", "01HEVTVENDOR000000000002", {
      ts: "2026-05-18T08:00:05.000Z",
      payload: { text: "Vendor metadata is namespaced and opaque to the validator." },
      meta: { "io.agent-trail.demo/render_hint": "timeline-note" },
    }),
    trailLine("tool_call", "01HEVTVENDOR000000000003", {
      ts: "2026-05-18T08:00:08.000Z",
      payload: {
        tool: "shell_command",
        args: { command: "trail inspect vendor-demo.trail.jsonl" },
      },
      meta: { "com.example/run_id": "run-42" },
    }),
    trailLine("tool_result", "01HEVTVENDOR000000000004", {
      ts: "2026-05-18T08:00:09.000Z",
      payload: {
        for_id: "01HEVTVENDOR000000000003",
        ok: true,
        output: "ignored unknown namespaced metadata",
      },
      meta: { "com.example/result_kind": "inspection" },
    }),
    trailLine("session_summary", "01HEVTVENDOR000000000005", {
      ts: "2026-05-18T08:00:11.000Z",
      payload: { text: "Extensions remain additive and namespaced." },
    }),
  ];
}

function treeBranchingSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSTREE00000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-17T21:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("user_message", "01HEVTTREE00000000000001", {
      ts: "2026-05-17T21:00:03.000Z",
      payload: { text: "Try two approaches, then keep the better branch." },
    }),
    trailLine("agent_message", "01HEVTTREE00000000000002", {
      ts: "2026-05-17T21:00:06.000Z",
      parent_id: "01HEVTTREE00000000000001",
      payload: { text: "Branch A changes the parser." },
    }),
    trailLine("agent_message", "01HEVTTREE00000000000003", {
      ts: "2026-05-17T21:00:07.000Z",
      parent_id: "01HEVTTREE00000000000001",
      payload: { text: "Branch B changes the renderer only." },
    }),
    trailLine("branch_summary", "01HEVTTREE00000000000004", {
      ts: "2026-05-17T21:00:10.000Z",
      parent_id: "01HEVTTREE00000000000003",
      payload: {
        abandoned_branch_id: "01HEVTTREE00000000000002",
        summary: "Parser branch was unnecessary.",
      },
    }),
    trailLine("agent_message", "01HEVTTREE00000000000005", {
      ts: "2026-05-17T21:00:12.000Z",
      parent_id: "01HEVTTREE00000000000004",
      payload: { text: "Continuing from the renderer branch." },
    }),
  ];
}

function agentRegistrySampleLines(): string[] {
  return [
    trailLine("session", "01HSESSREGISTRY0000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-18T08:20:00.000Z",
      agent: { name: "codex-cli", version: "0.1.5" },
    }),
    trailLine("session_metadata_update", "01HEVTREGISTRY000000001", {
      ts: "2026-05-18T08:20:02.000Z",
      payload: { agent: { name: "claude-code", version: "2.1.42" } },
    }),
    trailLine("agent_message", "01HEVTREGISTRY000000002", {
      ts: "2026-05-18T08:20:05.000Z",
      payload: { text: "Agent names are lowercase, hyphenated registry identifiers." },
    }),
    trailLine("tool_call", "01HEVTREGISTRY000000003", {
      ts: "2026-05-18T08:20:07.000Z",
      payload: { tool: "shell_command", args: { command: "trail agents list --canonical" } },
    }),
    trailLine("tool_result", "01HEVTREGISTRY000000004", {
      ts: "2026-05-18T08:20:08.000Z",
      payload: {
        for_id: "01HEVTREGISTRY000000003",
        ok: true,
        output: "codex-cli\nclaude-code\npi",
      },
    }),
    trailLine("session_summary", "01HEVTREGISTRY000000005", {
      ts: "2026-05-18T08:20:10.000Z",
      payload: { text: "Registry names are stable labels, not product marketing names." },
    }),
  ];
}

function truncationSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSTRUNC0000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-18T09:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    trailLine("tool_call", "01HEVTTRUNC000000000001", {
      ts: "2026-05-18T09:00:03.000Z",
      payload: { tool: "shell_command", args: { command: "cat large-build.log" } },
    }),
    trailLine("tool_result", "01HEVTTRUNC000000000002", {
      ts: "2026-05-18T09:00:05.000Z",
      payload: {
        for_id: "01HEVTTRUNC000000000001",
        ok: true,
        output: "first 4096 bytes...",
        truncated: true,
        original_bytes: 482133,
      },
      source: { raw: { elided: true, size_bytes: 482133 } },
    }),
    trailLine("system_event", "01HEVTTRUNC000000000003", {
      ts: "2026-05-18T09:00:06.000Z",
      payload: { kind: "diagnostic", severity: "warning", code: "source_raw_elided" },
    }),
    trailLine("agent_message", "01HEVTTRUNC000000000004", {
      ts: "2026-05-18T09:00:08.000Z",
      payload: {
        text: "The display output is capped, while source.raw records that bytes were omitted.",
      },
    }),
    trailLine("session_summary", "01HEVTTRUNC000000000005", {
      ts: "2026-05-18T09:00:10.000Z",
      payload: {
        text: "Large raw sources can be elided without pretending the output was complete.",
      },
    }),
  ];
}

function redactionSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSREDACT000000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-18T09:30:00.000Z",
      content_hash: SAMPLE_REDACTED_HASH,
      redacted_from: { content_hash: SAMPLE_SESSION_HASH },
      agent: { name: "codex-cli" },
    }),
    trailLine("tool_call", "01HEVTREDACT00000000001", {
      ts: "2026-05-18T09:30:03.000Z",
      payload: { tool: "shell_command", args: { command: "curl https://api.example.test/users" } },
      meta: { redaction_count: 1 },
    }),
    trailLine("tool_result", "01HEVTREDACT00000000002", {
      ts: "2026-05-18T09:30:05.000Z",
      payload: { for_id: "01HEVTREDACT00000000001", ok: true, output: "[REDACTED USER DATA]" },
      source: {
        raw: {
          headers: { Authorization: "[REDACTED]" },
          body: { elided: true, size_bytes: 18304 },
        },
      },
      meta: { redaction_count: 3 },
    }),
    trailLine("session_summary", "01HEVTREDACT00000000003", {
      ts: "2026-05-18T09:30:08.000Z",
      payload: { text: "Shared artifact preserves provenance without exposing secrets." },
    }),
    trailLine("system_event", "01HEVTREDACT00000000004", {
      ts: "2026-05-18T09:30:10.000Z",
      payload: { kind: "diagnostic", severity: "info", code: "share_time_redaction_applied" },
    }),
    trailLine("agent_message", "01HEVTREDACT00000000005", {
      ts: "2026-05-18T09:30:12.000Z",
      payload: { text: "Raw and redacted trails are separate artifacts with different hashes." },
    }),
  ];
}

function validationSampleLines(): string[] {
  return [
    trailLine("session", "01HSESSVALIDATE0000000001", {
      schema_version: CURRENT_SPEC_VERSION,
      ts: "2026-05-18T10:00:00.000Z",
      agent: { name: "trail-cli", version: "0.3.0" },
    }),
    trailLine("tool_call", "01HEVTVALIDATE000000001", {
      ts: "2026-05-18T10:00:03.000Z",
      payload: { tool: "shell_command", args: { command: "trail validate session.trail.jsonl" } },
    }),
    trailLine("tool_result", "01HEVTVALIDATE000000002", {
      ts: "2026-05-18T10:00:04.000Z",
      payload: {
        for_id: "01HEVTVALIDATE000000001",
        ok: true,
        output: "writer schema ok; graph ok; hashes warn: missing content_hash",
      },
    }),
    trailLine("system_event", "01HEVTVALIDATE000000003", {
      ts: "2026-05-18T10:00:05.000Z",
      payload: { kind: "diagnostic", severity: "warning", code: "missing_final_content_hash" },
    }),
    trailLine("agent_message", "01HEVTVALIDATE000000004", {
      ts: "2026-05-18T10:00:07.000Z",
      payload: {
        text: "Schema validation, graph validation, and hash checks are separate layers.",
      },
    }),
    trailLine("session_summary", "01HEVTVALIDATE000000005", {
      ts: "2026-05-18T10:00:09.000Z",
      payload: { text: "Writer-strict validation passed; hash completeness produced a warning." },
    }),
  ];
}

function minimalSampleLines(): string[] {
  return atAGlanceSampleLines();
}

function highlightLinesForSection(sectionId: string, mainSectionId: string): number[] {
  const normalized = `${sectionId} ${mainSectionId}`;
  if (/tool|taxonomy|terminal|mcp|shell|file_/.test(normalized)) return [2, 3];
  if (
    /validation|schema|diagnostic|reader|writer|format|encoding|layout|version/.test(normalized)
  ) {
    return [0, 2, 3];
  }
  if (/hash|identity|artifact|fork|redacted|envelope|header|branch|tree/.test(normalized)) {
    return [0, 1];
  }
  if (/segment|multi-session|group|reconciliation/.test(normalized)) return [1, 3];
  if (/user-message|agent-message|message|event|summary|optional|mandatory/.test(normalized)) {
    return [1, 2, 4];
  }
  if (/extension|vendor|raw|redaction|truncation|overflow|registry/.test(normalized))
    return [0, 1, 2];
  return [0, 1, 2];
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
