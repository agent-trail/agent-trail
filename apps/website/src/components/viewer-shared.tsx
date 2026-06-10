import type { ViewerEvent } from "../gist-viewer.ts";

export const SECTION_SUMMARY_CLASS =
  "flex min-h-5 cursor-pointer list-none items-center gap-3 py-0.5 text-[10px] tracking-[0.08em] text-muted uppercase tabular-nums [&::-webkit-details-marker]:hidden";
export const DISCLOSURE_MARKER_CLASS = "shrink-0 text-[9px] font-normal text-muted tabular-nums";

export function EventHeaderContent({
  index,
  label,
  timestamp,
}: {
  index: number;
  label: string;
  timestamp: string | null;
}) {
  return (
    <>
      <span className="min-w-0 shrink truncate">
        [{String(index + 1).padStart(2, "0")}] {label}
      </span>
      <span className="h-px flex-1 bg-line-muted" />
      <EventTime timestamp={timestamp} />
    </>
  );
}

function EventTime({ timestamp }: { timestamp: string | null | undefined }) {
  const formatted = formatEventTimestamp(timestamp);
  if (formatted === null) return null;
  return (
    <span className="w-[10.6rem] shrink-0 text-right text-[10px] tracking-[0.08em] text-muted tabular-nums">
      {formatted}
    </span>
  );
}

function formatEventTimestamp(timestamp: string | null | undefined): string | null {
  if (timestamp === null || timestamp === undefined || timestamp.length === 0) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(timestamp);
  if (match?.[1] !== undefined && match[2] !== undefined) return `${match[1]}  ${match[2]}`;
  return timestamp;
}

export function EventMeta({ event }: { event: ViewerEvent }) {
  return (
    <dl className="m-0 grid gap-1 text-[11px] leading-5 text-muted">
      {event.meta.map((item) => (
        <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2" key={item.label}>
          <dt className="font-bold uppercase">{item.label}</dt>
          <dd className="m-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
