"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { CalendarClock, Play, Pause, Trash2, Plus } from "lucide-react";
import { createOrder, deleteOrder, getOrders, toggleOrder, type StandingOrder } from "@/lib/engine";
import { useVerified } from "./useSession";

/**
 * Standing orders — what the card is *for*: set the agent to do recurring work on
 * a schedule, paid in USDC, governed by the same caps + kill switch. Set it and
 * walk away; it keeps earning its credit score while you sleep.
 */
export function StandingOrders() {
  const { address, isConnected } = useAccount();
  const verified = useVerified(address);
  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [goal, setGoal] = useState("Research the latest AI agent news and summarize the top 3 items");
  const [budget, setBudget] = useState(0.1);
  const [every, setEvery] = useState(10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const refresh = () => {
    if (address) getOrders(address).then(setOrders).catch(() => {});
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!isConnected) return null;

  async function add() {
    if (!address) return;
    setBusy(true);
    setNote("");
    try {
      await createOrder(address, goal, budget, every);
      setGoal("");
      refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fmtNext = (o: StandingOrder) => {
    if (!o.active) return "paused";
    const next = o.lastRunAt + o.everyMinutes * 60_000 - Date.now();
    if (next <= 0) return "due now";
    const m = Math.floor(next / 60000);
    const s = Math.floor((next % 60000) / 1000);
    return m > 0 ? `in ${m}m ${s}s` : `in ${s}s`;
  };

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-sm">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent">
          <CalendarClock size={15} />
        </span>
        <span className="font-medium">Standing orders</span>
        <span className="text-xs text-muted">— autonomous recurring jobs the card funds</span>
        {orders.length > 0 && (
          <span className="rounded-full bg-panel2 px-2 py-0.5 font-mono text-[11px] text-muted">{orders.filter((o) => o.active).length} active</span>
        )}
        <span className="ml-auto text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {/* Create */}
          <div className="rounded-lg border border-edge bg-bg p-3">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Research AI agent news and summarize the top 3"
              className="w-full rounded-md border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-accent/50"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="text-xs uppercase tracking-wide text-muted">every</label>
              <input type="number" min={1} value={every} onChange={(e) => setEvery(Number(e.target.value))} className="w-16 rounded-md border border-edge bg-panel px-2 py-1.5 outline-none focus:border-accent/50" />
              <span className="text-xs text-muted">min</span>
              <label className="text-xs uppercase tracking-wide text-muted">budget $</label>
              <input type="number" step="0.05" value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-20 rounded-md border border-edge bg-panel px-2 py-1.5 outline-none focus:border-accent/50" />
              <button onClick={add} disabled={busy || !verified || goal.trim().length < 4} title={!verified ? "Verify wallet ownership first" : ""} className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[#04130c] disabled:opacity-50">
                <Plus size={13} /> {busy ? "Adding…" : verified ? "Schedule it" : "Verify to schedule"}
              </button>
            </div>
            {note && <div className="mt-2 text-xs text-warn">⚠ {note}</div>}
          </div>

          {/* List */}
          {orders.length === 0 ? (
            <p className="text-xs text-muted">No standing orders yet. Schedule one above and the agent runs it on its own — paying from your card, stopping the instant your kill switch trips.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="flex items-center gap-3 rounded-lg border border-edge bg-panel2/40 px-3 py-2 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${o.active ? "bg-accent" : "bg-muted"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{o.goal}</div>
                    <div className="font-mono text-[11px] text-muted">
                      every {o.everyMinutes}m · ${o.budget.toFixed(2)}/run · {o.runs} runs · ${o.totalSpent.toFixed(2)} spent · next {fmtNext(o)}
                      {o.lastNote && <span className="ml-1 opacity-70">· {o.lastNote}</span>}
                    </div>
                  </div>
                  <button onClick={() => address && toggleOrder(address, o.id).then(setOrders).catch(() => {})} disabled={!verified} title={!verified ? "Verify wallet ownership first" : o.active ? "Pause" : "Resume"} className="rounded-md border border-edge p-1.5 text-muted hover:text-ink disabled:opacity-40">
                    {o.active ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <button onClick={() => address && deleteOrder(address, o.id).then(setOrders).catch(() => {})} disabled={!verified} title={!verified ? "Verify wallet ownership first" : "Delete"} className="rounded-md border border-edge p-1.5 text-muted hover:text-warn disabled:opacity-40">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
