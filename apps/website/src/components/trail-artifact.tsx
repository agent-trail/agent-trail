import { JsonlCode } from "./jsonl-code.tsx";

export function TrailArtifact({ code }: { code: string }) {
  const lines = code.split("\n");

  return (
    <figure
      className="border-main relative m-0 min-w-0 flex-1 overflow-hidden bg-accent p-6"
      aria-labelledby="trail-example-title"
    >
      <figcaption className="mb-6 flex justify-between border-b-main border-muted/20 pb-2 text-xs">
        <span id="trail-example-title">EXAMPLE.TRAIL.JSONL</span>
        <span className="opacity-50">APPLICATION/JSONL</span>
      </figcaption>
      <pre className="m-0 overflow-x-auto text-xs leading-relaxed">
        <JsonlCode
          className="grid gap-1"
          lineClassName="break-words whitespace-pre-wrap"
          lines={lines}
        />
      </pre>
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:radial-gradient(var(--at-fg)_1px,transparent_0)] [background-size:20px_20px]" />
    </figure>
  );
}
