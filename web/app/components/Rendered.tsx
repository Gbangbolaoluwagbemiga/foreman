"use client";

import { Download } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Renders deliverable text as formatted output: images, headings, bullet lists,
 * and paragraphs — with inline **bold**, *italic*, `code`, and [links](url)
 * turned into real elements (as React nodes, so no HTML injection / XSS risk).
 */
export function Rendered({ text }: { text: string }) {
  // Line-level parse — a single block often mixes a heading, bullets, and a
  // trailing paragraph, so we can't assume any block is homogeneous.
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = []; // buffer of consecutive plain lines
  let list: { ordered: boolean; items: string[] } | null = null; // buffer of consecutive bullets

  const flushPara = () => {
    if (!para.length) return;
    const buf = para;
    out.push(
      <p key={`p${out.length}`} className="text-sm leading-relaxed text-ink/80">
        {buf.map((l, j) => (
          <span key={j}>
            {renderInline(l)}
            {j < buf.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const cls = "space-y-1 pl-5 text-sm text-ink/80 marker:text-muted";
    out.push(
      ordered ? (
        <ol key={`l${out.length}`} className={`list-decimal ${cls}`}>
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ol>
      ) : (
        <ul key={`l${out.length}`} className={`list-disc ${cls}`}>
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      ),
    );
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; } // blank line ends the current block

    const img = line.match(/^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/);
    if (img) { flush(); out.push(<DownloadableImage key={`i${out.length}`} src={img[1]!} />); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push(<h4 key={`h${out.length}`} className="mt-1 text-sm font-semibold text-ink">{renderInline(h[2]!)}</h4>); continue; }

    const bullet = line.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/);
    if (bullet) {
      const ordered = bullet[1] !== undefined;
      flushPara();
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(bullet[2]!);
      continue;
    }

    // plain text line
    flushList();
    para.push(line);
  }
  flush();

  return <div className="space-y-3">{out}</div>;
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
