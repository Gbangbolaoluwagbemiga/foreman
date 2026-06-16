"use client";

import { Download } from "lucide-react";

/** Minimal renderer: turns deliverable text into images, headings, and paragraphs. */
export function Rendered({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}|\n(?=#{1,3}\s)|\n(?=!\[)/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const img = b.match(/^!\[[^\]]*\]\(([^)]+)\)/);
        if (img) return <DownloadableImage key={i} src={img[1]!} />;
        const h = b.match(/^(#{1,3})\s+(.*)$/);
        if (h) return <h4 key={i} className="text-sm font-semibold text-ink">{h[2]}</h4>;
        return <p key={i} className="whitespace-pre-wrap text-sm text-ink/80">{b}</p>;
      })}
    </div>
  );
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
