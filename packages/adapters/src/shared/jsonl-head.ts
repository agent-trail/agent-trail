import { open } from "node:fs/promises";

export type JsonlHead = {
  lines: string[];
  truncated: boolean;
};

export async function readJsonlHead(path: string, maxBytes: number): Promise<JsonlHead> {
  const handle = await open(path, "r");
  let bytesRead: number;
  let buffer: Buffer;
  try {
    buffer = Buffer.allocUnsafe(maxBytes);
    const result = await handle.read(buffer, 0, maxBytes, 0);
    bytesRead = result.bytesRead;
  } finally {
    await handle.close().catch(() => {});
  }

  if (bytesRead === 0) return { lines: [], truncated: false };

  const text = buffer.subarray(0, bytesRead).toString("utf-8");
  const truncated = bytesRead === maxBytes;
  if (!truncated) {
    return { lines: completeLines(text), truncated };
  }

  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) return { lines: [], truncated };
  return { lines: completeLines(text.slice(0, lastNewline)), truncated };
}

function completeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0);
}

export async function readJsonlHeadObjects(
  path: string,
  maxBytes: number,
): Promise<Record<string, unknown>[]> {
  const { lines } = await readJsonlHead(path, maxBytes);
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        records.push(value as Record<string, unknown>);
      }
    } catch {
      // Tolerant source sniffing skips malformed lines.
    }
  }
  return records;
}
