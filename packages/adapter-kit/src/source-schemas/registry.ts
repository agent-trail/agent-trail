import ccV1 from "@agent-trail/source-schemas/claude-code/v1" with { type: "json" };
import codexV0128 from "@agent-trail/source-schemas/codex/v0.128" with { type: "json" };
import piV1 from "@agent-trail/source-schemas/pi/v1" with { type: "json" };
import type { ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";

type SourceSchema = Record<string, unknown>;

/**
 * Static registry of source-format schemas. Each entry is keyed `agent/version`.
 * Schemas are imported statically (not loaded by path) so the kit stays
 * bundler-friendly, matching how `@agent-trail/core` imports the trail schema.
 */
const schemas: Record<string, SourceSchema> = {
  "codex/v0.128": codexV0128 as SourceSchema,
  "pi/v1": piV1 as SourceSchema,
  "claude-code/v1": ccV1 as SourceSchema,
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of Object.values(schemas)) {
  ajv.addSchema(schema);
}

const validators = new Map<string, ValidateFunction>(
  Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]),
);

export function getSourceValidator(agent: string, version: string): ValidateFunction | undefined {
  return validators.get(`${agent}/${version}`);
}
