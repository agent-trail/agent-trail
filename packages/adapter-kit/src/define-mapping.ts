import type { RawRecord } from "./readers/types.ts";
import type { MappingDef } from "./types.ts";

/**
 * Identity builder for a pure mapping. Exists for the type inference: the
 * generic pins `emit`'s input to the source-schema type the author declares.
 */
export function defineMapping<T extends RawRecord>(def: MappingDef<T>): MappingDef<T> {
  return def;
}
