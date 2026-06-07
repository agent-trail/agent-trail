import type { ReactNode } from "react";

export function JsonlCode({
  className,
  lineClassName,
  lines,
}: {
  className?: string;
  lineClassName?: string | ((index: number, line: string) => string | undefined);
  lines: string[];
}) {
  const lineKeys = new Map<string, number>();

  return (
    <code className={className}>
      {Array.from(lines.entries()).map(([index, line]) => {
        const className =
          typeof lineClassName === "function" ? lineClassName(index, line) : lineClassName;
        const lineCount = (lineKeys.get(line) ?? 0) + 1;
        lineKeys.set(line, lineCount);
        return (
          <span className={className} key={`${line}-${lineCount}`}>
            {renderJsonLine(line)}
          </span>
        );
      })}
    </code>
  );
}

function renderJsonLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const keyPattern = /"([^"]+)":/g;
  let cursor = 0;

  for (const match of line.matchAll(keyPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) nodes.push(line.slice(cursor, matchIndex));

    nodes.push(
      <span className="json-key font-bold text-fg" key={`${matchIndex}-${match[1]}`}>
        &quot;{match[1]}&quot;
      </span>,
    );
    nodes.push(
      <span className="json-punctuation text-muted" key={`${matchIndex}-colon`}>
        :
      </span>,
    );
    cursor = matchIndex + match[0].length;
  }

  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}
