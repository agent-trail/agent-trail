import type { MappingDef } from "@agent-trail/adapter-kit";
import { capabilityMappings } from "./mapping/capabilities.ts";
import { messageMappings } from "./mapping/messages.ts";
import { metadataMappings } from "./mapping/metadata.ts";
import type { Raw } from "./mapping/shared.ts";
import { systemMappings } from "./mapping/system.ts";

export {
  type CcHint,
  HINT,
  INCLUDE_SIDECHAIN,
  INLINE_ATTACHMENT_MAX_DECODED_BYTES,
} from "./mapping/shared.ts";

export const claudeCodeMappings: MappingDef<Raw>[] = [
  ...messageMappings,
  ...metadataMappings,
  ...capabilityMappings,
  ...systemMappings,
];
