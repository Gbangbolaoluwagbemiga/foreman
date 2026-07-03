"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { KeyRound, Copy, Check, Trash2, Plus, ChevronDown, ChevronRight, X } from "lucide-react";
import { listApiKeys, createApiKey, revokeApiKey, clearSession, type ApiKeyMeta } from "@/lib/engine";
import { useVerified } from "./useSession";

const COLLAPSE_KEY = "foreman_apikeys_collapsed";

/**
 * Agent API keys: mint a credential a headless agent (Claude Code via MCP, or the
 * /delegate API) uses to spend from THIS account — inside its caps + credit line.
 * The full secret is shown exactly once.
 */
export function ApiKeys() {
  const { address, isConnected } = useAccount();
  const verified = useVerified(address);
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [fresh, setFresh] = useState<string | null>(null); // the just-minted secret (shown once)
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);
  useEffect(() => {
    if (!address || !verified) return;
    listApiKeys(address).then(setKeys).catch(() => {});
  }, [address, verified]);

  if (!mounted || !isConnected) return null;

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined") localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const mint = async () => {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      const { apiKey } = await createApiKey(address, "agent key");
      setFresh(apiKey);
      // Refresh the list, but a hiccup here must NOT mask a successful mint.
      listApiKeys(address).then(setKeys).catch(() => {});
    } catch (e) {
      const msg = (e as Error)?.message ?? "Could not mint key.";
      if (/verify wallet ownership/i.test(msg)) {
        // Stale session (e.g. engine restarted with a new AUTH_SECRET). Clear it so
        // the badge flips to unverified and the user re-verifies with one signature.
        clearSession();
        setErr("Your session expired (the engine restarted) — click “Verify ownership” again, then retry.");
      } else if (msg.includes("404") || /Unexpected|JSON|fetch/i.test(msg)) {
        setErr("Couldn't reach the key endpoint — restart the engine (npm run serve:gateway) so it picks up the new route.");
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!address) return;
    setKeys(await revokeApiKey(address, id).catch(() => keys));
  };

  const copy = () => {
    if (!fresh) return;
    navigator.clipboard?.writeText(fresh);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          onClick={toggleCollapse}
          className="flex items-center gap-2 text-sm"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
          <KeyRound size={16} className="text-accent" />
          <span className="font-medium">Agent API keys</span>
          {verified && keys.length > 0 && (
            <span className="text-[11px] text-muted">· {keys.length}</span>
          )}
          {!verified && <span className="text-[11px] text-amber-300/80">verify ownership to manage</span>}
        </button>
        {!collapsed && (
          <button
            onClick={mint}
            disabled={!verified || busy}
            title={!verified ? "Verify wallet ownership first" : "Mint a key for a headless agent"}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50"
          >
            <Plus size={13} /> {busy ? "Minting…" : "Create agent key"}
          </button>
        )}
      </div>

      {collapsed ? null : (
        <>
      <p className="mt-2 text-xs text-muted">
        Give an AI (e.g. Claude Code via MCP) a key so it can hire and pay specialists <em>from this account</em> —
        capped by your kill switch, caps, and credit line. Revoke anytime.
      </p>

      {err && <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</p>}

      {/* The freshly-minted secret — shown exactly once */}
      {fresh && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-accent">Copy now — shown once</span>
            <div className="flex items-center gap-3">
              <button onClick={copy} className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "copied" : "copy"}
              </button>
              <button onClick={() => setFresh(null)} title="Dismiss" className="text-muted hover:text-ink">
                <X size={13} />
              </button>
            </div>
          </div>
          <code className="block break-all font-mono text-[11px] text-ink">{fresh}</code>
          <p className="mt-2 text-[11px] text-muted">
            Use it in your MCP config: <code className="text-ink">FOREMAN_API_KEY={"{this key}"}</code>.
            It won’t be shown again — it’ll appear below as <code className="text-ink">fmn_…</code> once dismissed.
          </p>
        </div>
      )}

      {/* Active keys */}
      {verified && keys.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-2 rounded-lg border border-edge bg-panel2 px-3 py-1.5 text-xs">
              <span className="font-mono text-muted">fmn_…{k.id}</span>
              {k.label && <span className="text-muted">· {k.label}</span>}
              <span className="ml-auto text-[11px] text-muted">{new Date(k.createdAt).toLocaleDateString()}</span>
              <button onClick={() => revoke(k.id)} title="Revoke" className="text-muted hover:text-warn">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
        </>
      )}
    </div>
  );
}
