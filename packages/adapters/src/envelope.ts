import type { Header, TrailEnvelope } from "@agent-trail/types";

export type BuildTrailEnvelopeOptions = {
  producer: string;
  header: Header;
  /** Override for deterministic tests; defaults to crypto.randomUUID(). */
  randomId?: () => string;
  /** Override for deterministic tests; defaults to new Date().toISOString(). */
  now?: () => string;
  name?: string;
  meta?: Record<string, unknown>;
};

export function buildTrailEnvelope(opts: BuildTrailEnvelopeOptions): TrailEnvelope {
  const randomId = opts.randomId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => new Date().toISOString());
  const envelope: TrailEnvelope = {
    type: "trail",
    schema_version: "0.1.0",
    id: randomId(),
    ts: now(),
    producer: opts.producer,
  };
  if (opts.name !== undefined) envelope.name = opts.name;
  if (opts.meta !== undefined && Object.keys(opts.meta).length > 0) envelope.meta = opts.meta;
  if (opts.header.vcs !== undefined) envelope.vcs = opts.header.vcs;
  // Populate a minimal sessions manifest so indexers can enumerate sessions
  // without parsing event records. The session header remains authoritative;
  // the validator warns on drift.
  envelope.sessions = [{ id: opts.header.id, agent: opts.header.agent.name }];
  return envelope;
}
