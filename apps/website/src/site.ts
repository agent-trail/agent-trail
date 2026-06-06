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
  status: "available" | "planned" | "shell";
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
  "Agent Trail is a portable JSONL format for coding-agent sessions. It preserves messages, tool calls, tool results, summaries, and provenance so sessions can move across tools.";

const CODE_PREVIEW = [
  '{"type":"session","schema_version":"0.1.0","id":"sess_01","ts":"2026-06-06T11:42:00.000Z"}',
  '{"type":"user_message","id":"evt_01","parent_id":"sess_01","payload":{"text":"Add README.md"}}',
  '{"type":"agent_message","id":"evt_02","parent_id":"evt_01","payload":{"text":"Writing overview."}}',
  '{"type":"tool_call","id":"evt_03","parent_id":"evt_02","payload":{"tool":"fs.write","args":{"path":"README.md"}}}',
  '{"type":"tool_result","id":"evt_04","parent_id":"evt_03","payload":{"for_id":"evt_03","ok":true}}',
  '{"type":"summary","id":"evt_05","parent_id":"evt_04","payload":{"text":"README added with project usage."}}',
  '{"type":"tool_call","id":"evt_06","parent_id":"evt_05","payload":{"tool":"git.diff","args":{"path":"README.md"}}}',
  '{"type":"tool_result","id":"evt_07","parent_id":"evt_06","payload":{"for_id":"evt_06","ok":true,"bytes":1842}}',
  '{"type":"agent_message","id":"evt_08","parent_id":"evt_07","payload":{"text":"Validated the generated trail."}}',
  '{"type":"session_end","id":"evt_09","parent_id":"evt_08","payload":{"status":"complete"}}',
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
    status: "shell",
    href: "/view/gist/example",
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
    html: await renderMarkdown(markdown),
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

  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const title = titleOf(tokens[index + 1]);
    const slug = uniqueHeadingSlug(env, title);
    const token = tokens[index];
    if (token === undefined) {
      return defaultHeadingOpen(tokens, index, options, env, self);
    }

    token.attrSet("id", slug);
    return defaultHeadingOpen(tokens, index, options, env, self);
  };

  md.renderer.rules.heading_close = (tokens, index, options, env, self) => {
    const title = titleOf(tokens[index - 1]);
    const slug = popHeadingSlug(env) ?? slugify(title);
    return `<a class="heading-anchor" href="#${slug}" aria-label="Link to ${escapeAttribute(
      title,
    )}">#</a>${defaultHeadingClose(tokens, index, options, env, self)}`;
  };

  return md;
}

async function renderMarkdown(markdown: string): Promise<string> {
  return (await renderer()).render(markdown, {});
}

function titleOf(token: { content?: string } | undefined): string {
  return token?.content ?? "section";
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
  const sampleDefs = [
    {
      id: "conversation-core",
      title: "Conversation core",
      sectionIds: ["agent-trail-specification", "1-motivation", "2-goals-and-non-goals"],
      lines: [
        trailLine("session", "01HSESS0000000000000000001", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "codex-cli" },
        }),
        trailLine("user_message", "01HEVTA0000000000000000001", {
          ts: "2026-05-17T14:00:05.000Z",
          payload: { text: "Preserve this coding session." },
        }),
        trailLine("agent_message", "01HEVTA0000000000000000002", {
          ts: "2026-05-17T14:00:07.000Z",
          payload: { text: "Writing a portable trail." },
        }),
      ],
    },
    {
      id: "starter-file",
      title: "Starter trail file",
      sectionIds: ["3-at-a-glance", "5-file-format", "5-2-encoding", "5-3-file-layout"],
      lines: [
        trailLine("session", "01HSESS0000000000000000002", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T15:00:00.000Z",
          agent: { name: "agent-trail-cli" },
        }),
        trailLine("user_message", "01HEVTB0000000000000000001", {
          ts: "2026-05-17T15:00:05.000Z",
          payload: { text: "Validate README trail." },
        }),
        trailLine("agent_message", "01HEVTB0000000000000000002", {
          ts: "2026-05-17T15:00:08.000Z",
          payload: { text: "Trail file is UTF-8 JSONL." },
        }),
      ],
    },
    {
      id: "terminology",
      title: "Terminology objects",
      sectionIds: ["4-terminology"],
      lines: [
        trailLine("trail", "01HTRAIL000000000000000001", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T15:10:00.000Z",
          name: "shared-review",
        }),
        trailLine("session", "01HSESS0000000000000000003", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T15:10:01.000Z",
          content_hash: "<pending>",
        }),
        trailLine("summary", "01HEVTC0000000000000000001", {
          ts: "2026-05-17T15:10:30.000Z",
          payload: { text: "Trail envelope wraps the session group." },
        }),
      ],
    },
    {
      id: "versioning",
      title: "Version contract",
      sectionIds: ["6-versioning"],
      lines: [
        trailLine("session", "01HSESS0000000000000000004", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T16:00:00.000Z",
        }),
        trailLine("agent_message", "01HEVTD0000000000000000001", {
          ts: "2026-05-17T16:00:03.000Z",
          payload: { text: "Writer emits schema_version 0.1.0." },
        }),
      ],
    },
    {
      id: "identity-hash",
      title: "Identity and hashes",
      sectionIds: [
        "7-identity-artifacts-and-content-addressing",
        "7-1-session-identity",
        "7-3-content-hash",
        "7-4-two-tier-identity",
      ],
      lines: [
        trailLine("session", "01HSESS0000000000000000005", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T17:00:00.000Z",
          content_hash: "<pending>",
          redacted_from: { content_hash: "sha256:raw-session" },
        }),
        trailLine("summary", "01HEVTE0000000000000000001", {
          ts: "2026-05-17T17:00:08.000Z",
          payload: { text: "Shared trail keeps redacted provenance." },
        }),
      ],
    },
    {
      id: "envelope",
      title: "Trail envelope",
      sectionIds: ["8-0-the-trail-envelope"],
      lines: [
        trailLine("trail", "01HTRAIL000000000000000002", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T18:00:00.000Z",
          content_hash: "<pending>",
          producer: { name: "trail" },
        }),
        trailLine("session", "01HSESS0000000000000000006", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T18:00:01.000Z",
        }),
      ],
    },
    {
      id: "events",
      title: "Events and messages",
      sectionIds: ["8-the-session-header", "9-events", "7-5-event-identifiers"],
      lines: [
        trailLine("session", "01HSESS0000000000000000007", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-17T19:00:00.000Z",
        }),
        trailLine("user_message", "01HEVTF0000000000000000001", {
          ts: "2026-05-17T19:00:04.000Z",
          payload: { text: "Show the current diff." },
        }),
        trailLine("agent_message", "01HEVTF0000000000000000002", {
          ts: "2026-05-17T19:00:10.000Z",
          payload: { text: "I will inspect the diff." },
        }),
      ],
    },
    {
      id: "tools",
      title: "Tool activity",
      sectionIds: ["9-5-tool-call-terminal-pairing", "10-canonical-tool-taxonomy"],
      lines: [
        trailLine("tool_call", "01HEVTG0000000000000000001", {
          ts: "2026-05-17T20:00:00.000Z",
          payload: { tool: "shell.exec", args: { cmd: "git diff --stat" } },
        }),
        trailLine("tool_result", "01HEVTG0000000000000000002", {
          ts: "2026-05-17T20:00:01.000Z",
          payload: { for_id: "01HEVTG0000000000000000001", ok: true },
        }),
      ],
    },
    {
      id: "summaries",
      title: "Summary record",
      sectionIds: ["9-3-optional-event-types"],
      lines: [
        trailLine("summary", "01HEVTH0000000000000000001", {
          ts: "2026-05-17T21:00:00.000Z",
          payload: { text: "Validated schema aliases and spec route." },
        }),
      ],
    },
    {
      id: "segments",
      title: "Segments and reconciliation",
      sectionIds: ["8-5-session-segments-multi-segment-sessions", "8-6-multi-session-trail-files"],
      lines: [
        trailLine("session", "01HSESS0000000000000000008", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-18T10:00:00.000Z",
          segment: { index: 2, prev_content_hash: "sha256:previous" },
        }),
        trailLine("agent_message", "01HEVTI0000000000000000001", {
          ts: "2026-05-18T10:00:05.000Z",
          payload: { text: "Reconciled incoming segment by id." },
        }),
      ],
    },
    {
      id: "validation",
      title: "Validation contract",
      sectionIds: ["16-validation", "16-1-writer-schema", "16-3-validation-diagnostics"],
      lines: [
        trailLine("session", "01HSESS0000000000000000009", {
          schema_version: CURRENT_SPEC_VERSION,
          ts: "2026-05-18T11:00:00.000Z",
        }),
        trailLine("tool_result", "01HEVTJ0000000000000000001", {
          ts: "2026-05-18T11:00:02.000Z",
          payload: { for_id: "01HEVTG0000000000000000001", ok: true },
        }),
      ],
    },
  ];

  const sectionIndexById = new Map(sections.map((section) => [section.id, section.index]));

  return sampleDefs
    .map((sample) => {
      const sectionIds = sample.sectionIds.filter((sectionId) => sectionIndexById.has(sectionId));

      return {
        id: sample.id,
        title: sample.title,
        sectionIds,
        lines: sample.lines,
        sortIndex: sectionIndexById.get(sectionIds[0] ?? "") ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map(({ sortIndex: _sortIndex, ...sample }) => sample);
}

function trailLine(type: string, id: string, rest: Record<string, unknown>): string {
  return JSON.stringify({ type, id, ...rest });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
