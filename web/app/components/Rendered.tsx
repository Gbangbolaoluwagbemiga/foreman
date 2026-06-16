/** Minimal renderer: turns deliverable text into images, headings, and paragraphs. */
export function Rendered({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}|\n(?=#{1,3}\s)|\n(?=!\[)/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const img = b.match(/^!\[[^\]]*\]\(([^)]+)\)/);
        if (img) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img[1]}
              alt="generated"
              className="w-full max-w-xl rounded-lg border border-edge"
              loading="lazy"
            />
          );
        }
        const h = b.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          return (
            <h4 key={i} className="text-sm font-semibold text-ink">
              {h[2]}
            </h4>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-sm text-ink/80">
            {b}
          </p>
        );
      })}
    </div>
  );
}
