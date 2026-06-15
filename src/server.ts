import http from "node:http";
import { config } from "./config";
import { CrewRegistry, usingRealBrain } from "./crew";
import { createLocalSigner } from "./signer";
import { createSettlement } from "./settlement";
import { runJob } from "./orchestrator";

const PORT = Number(process.env.PORT) || 8799;

// Long-lived state: the marketplace persists across jobs while the node runs,
// so reputation accrues in real time — the live economy.
const registry = CrewRegistry.seeded();
const settlement = createSettlement();
const foreman = createLocalSigner(config.foremanPrivateKey || undefined);

const clients = new Set<http.ServerResponse>();
const log: unknown[] = [];

function broadcast(event: unknown) {
  log.push(event);
  if (log.length > 200) log.shift();
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(line);
}

function crewSnapshot() {
  return {
    type: "crew",
    members: registry.members
      .map((m) => ({ name: m.name, skill: m.skill, priceUsdc: m.priceUsdc, reputation: m.reputation, jobs: m.jobsCompleted }))
      .sort((a, b) => b.reputation - a.reputation),
  };
}

async function handleRun(goal: string, budgetUsdc: number) {
  broadcast({ type: "job-start", goal, budgetUsdc, ts: Date.now() });
  try {
    const receipt = await runJob({ goal, budgetUsdc }, {
      registry,
      settlement,
      foreman,
      onEvent: (msg) => broadcast({ type: "log", msg, ts: Date.now() }),
    });
    broadcast({ type: "receipt", receipt, ts: Date.now() });
    broadcast(crewSnapshot());
  } catch (e) {
    broadcast({ type: "log", msg: `❌ ${(e as Error).message}`, ts: Date.now() });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE);
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", brain: usingRealBrain() ? config.groqModel : "mock", rail: settlement.rail, foreman: foreman.address })}\n\n`);
    res.write(`data: ${JSON.stringify(crewSnapshot())}\n\n`);
    for (const e of log) res.write(`data: ${JSON.stringify(e)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/run") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { goal, budget } = JSON.parse(body || "{}");
        const g = String(goal || "").trim();
        const b = Number(budget) || 1;
        if (!g) { res.writeHead(400).end(JSON.stringify({ error: "goal required" })); return; }
        void handleRun(g, b);
        res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "bad json" }));
      }
    });
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => {
  console.log(`\n  🟢 Foreman node live → http://localhost:${PORT}`);
  console.log(`     brain: ${usingRealBrain() ? config.groqModel : "mock"}   rail: ${settlement.rail}   crew: ${registry.members.length}`);
  console.log(`     POST a job:  curl -s localhost:${PORT}/run -d '{"goal":"...","budget":1}'\n`);
});

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Foreman — live</title>
<style>
 body{background:#0b0d10;color:#d8dee9;font:14px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:24px}
 h1{font-size:18px;margin:0 0 4px} .sub{color:#7a8290;margin-bottom:16px}
 .row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
 .panel{background:#12151a;border:1px solid #1e232b;border-radius:10px;padding:14px;flex:1;min-width:320px}
 input{background:#0b0d10;color:#d8dee9;border:1px solid #2a313b;border-radius:6px;padding:8px;font:inherit}
 #goal{width:100%;box-sizing:border-box} button{background:#3b6e4f;color:#fff;border:0;border-radius:6px;padding:9px 16px;cursor:pointer;font:inherit}
 #logwrap{height:340px;overflow:auto;background:#0b0d10;border-radius:8px;padding:10px;margin-top:10px}
 .log{white-space:pre-wrap;margin:2px 0} table{width:100%;border-collapse:collapse} td,th{text-align:left;padding:5px 8px;border-bottom:1px solid #1a1f27}
 .rep{color:#7fd1a0} .meta{color:#7a8290} .receipt{color:#e3c46b}
</style></head><body>
<h1>🏗️ Foreman — live node</h1>
<div class="sub" id="meta">connecting…</div>
<div class="row">
 <div class="panel" style="flex:2">
  <input id="goal" placeholder="Give Foreman a goal…" value="Write a short blog post about my new coffee shop 'Bean There', with a catchy headline and a header image concept.">
  <div style="margin-top:8px"><span class="meta">budget $</span><input id="budget" value="1" size="4"> <button onclick="run()">Hire a crew →</button></div>
  <div id="logwrap"></div>
 </div>
 <div class="panel"><b>Crew marketplace</b><table id="crew"><thead><tr><th>agent</th><th>skill</th><th>$</th><th>rep</th><th>jobs</th></tr></thead><tbody></tbody></table></div>
</div>
<script>
 var wrap=document.getElementById('logwrap');
 function add(cls,txt){var d=document.createElement('div');d.className='log '+cls;d.textContent=txt;wrap.appendChild(d);wrap.scrollTop=wrap.scrollHeight;}
 function run(){fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal:document.getElementById('goal').value,budget:document.getElementById('budget').value})});}
 var es=new EventSource('/events');
 es.onmessage=function(ev){var e=JSON.parse(ev.data);
   if(e.type==='hello'){document.getElementById('meta').textContent='brain: '+e.brain+'   •   rail: '+e.rail+'   •   foreman: '+e.foreman;}
   else if(e.type==='crew'){var b='';e.members.forEach(function(m){b+='<tr><td>'+m.name+'</td><td>'+m.skill+'</td><td>'+m.priceUsdc.toFixed(2)+'</td><td class=rep>'+m.reputation+'</td><td>'+m.jobs+'</td></tr>';});document.querySelector('#crew tbody').innerHTML=b;}
   else if(e.type==='job-start'){add('meta','──────── new job: '+e.goal+' ($'+e.budgetUsdc+')');}
   else if(e.type==='log'){add('',e.msg);}
   else if(e.type==='receipt'){var r=e.receipt;add('receipt','🧾 spent $'+r.spentUsdc.toFixed(2)+' / $'+r.budgetUsdc.toFixed(2)+' • change $'+r.changeUsdc.toFixed(2)+' • '+r.lineItems.length+' crew paid • rail '+r.rail);}
 };
</script></body></html>`;
