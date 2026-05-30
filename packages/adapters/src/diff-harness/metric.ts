import type { AdapterDef } from "@agent-trail/adapter-kit";

/**
 * Declarative-coverage metric for a kit-based adapter (issue #146 success
 * criterion): how much of the adapter escaped the pure mapping DSL into
 * stateful overrides. `ratio = override / (pure + override)` — lower is better
 * (more behavior expressed declaratively). Reported per migration PR.
 */
export interface MappingShapeMetric {
  pure: number;
  override: number;
  ratio: number;
}

export function mappingShapeMetric(def: AdapterDef): MappingShapeMetric {
  const pure = def.mappings.length;
  const override = def.overrides?.length ?? 0;
  const total = pure + override;
  return { pure, override, ratio: total === 0 ? 0 : override / total };
}
