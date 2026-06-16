export default function ActivityPage() {
  return (
    <div className="py-16">
      <h1 className="text-2xl font-semibold">On-chain activity</h1>
      <p className="mt-2 text-muted">
        Every agent-to-agent payment, with links to the settlement on Arcscan.
      </p>
      <div className="mt-8 rounded-xl border border-edge bg-panel p-8 text-sm text-muted">
        Indexing payments…
      </div>
    </div>
  );
}
