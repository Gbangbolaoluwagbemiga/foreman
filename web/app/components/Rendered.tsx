"use client";

import { Download } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Renders deliverable text as formatted output: images, headings, bullet lists,
 * and paragraphs — with inline **bold**, *italic*, `code`, and [links](url)
 * turned into real elements (as React nodes, so no HTML injection / XSS risk).
 */
export function Rendered({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}|\n(?=#{1,3}\s)|\n(?=!\[)/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const img = b.match(/^!\[[^\]]*\]\(([^)]+)\)/);
        if (img) return <DownloadableImage key={i} src={img[1]!} />;

        const h = b.match(/^(#{1,6})\s+(.*)$/);
        if (h) return <h4 key={i} className="text-sm font-semibold text-ink">{renderInline(h[2]!)}</h4>;

        // A block whose every line is a bullet / numbered item → a list.
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d+[.)]\s+/.test(lines[0]!);
          const items = lines.map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
          return ordered ? (
            <ol key={i} className="list-decimal space-y-1 pl-5 text-sm text-ink/80 marker:text-muted">
              {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm text-ink/80 marker:text-muted">
              {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ul>
          );
        }

        // Plain paragraph — keep single line breaks, render inline formatting per line.
        return (
          <p key={i} className="text-sm leading-relaxed text-ink/80">
            {lines.map((l, j) => (
              <span key={j}>
                {renderInline(l)}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Turn inline markdown into React nodes: **bold**, *italic* / _italic_,
 * `code`, and [text](url). Order matters — code is pulled out first so its
 * contents aren't re-parsed. Everything stays a React node, never raw HTML.
 */
function renderInline(text: string): ReactNode[] {
  // token regex, tried in order: code | bold | italic(*) | italic(_) | link
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)]+\))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(<code key={k++} className="rounded bg-panel2 px-1 py-0.5 font-mono text-[0.85em] text-ink">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k++} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("_")) {
      out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push(<a key={k++} href={lm[2]} target="_blank" rel="noreferrer" className="text-accent hover:underline">{lm[1]}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function DownloadableImage({ src }: { src: string }) {
  const download = async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `foreman-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // CORS-blocked fetch → just open it so the user can save manually.
      window.open(src, "_blank");
    }
  };
  return (
    <div className="group relative inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="generated" className="w-full max-w-xl rounded-lg border border-edge" loading="lazy" />
      <button
        onClick={download}
        className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md border border-edge bg-bg/80 px-2.5 py-1 text-xs text-ink opacity-0 backdrop-blur transition-opacity hover:border-accent/40 group-hover:opacity-100"
      >
        <Download size={12} /> Download
      </button>
    </div>
  );
}
