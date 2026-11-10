// The phone page (served only on the local network by phone.cjs). Self-contained:
// no external scripts, fonts or services. Everything shown is escaped.
// Look: the app's calm warm theme in one column (light or dark, following the phone),
// team chips with status dots, chat, approval cards with large buttons, a composer and a
// bottom tab bar. Typing is never interrupted: no redraw or scroll while the box has focus.
const PHONE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Hearth AI on your phone</title>
<style>
:root{--bg:#f8f5ef;--side:#f1ece3;--card:#fffdf9;--sunk:#efe9df;--line:#e5ddd0;--line2:#d8cebe;--text:#2d2822;--strong:#1c1915;--muted:#71685c;--faint:#9a9083;--accent:#c8492c;--ink:#fff;--soft:#f6e2d9;--good:#3f7d4e;--goods:#e3efe4;--warn:#9a6a12;--warns:#f5ebd2;--bad:#b23a2e;--bads:#f6dfdb;--shadow:0 1px 2px rgba(60,45,30,.05),0 6px 24px rgba(60,45,30,.07)}
@media (prefers-color-scheme:dark){:root{--bg:#1d1a17;--side:#171512;--card:#26221e;--sunk:#221f1b;--line:#36302a;--line2:#443c34;--text:#e9e2d7;--strong:#f7f2ea;--muted:#a69c8e;--faint:#7a7166;--accent:#ec7552;--ink:#1d1a17;--soft:#3d2a22;--good:#7fbf8d;--goods:#233328;--warn:#e0b45c;--warns:#362d1b;--bad:#ec8577;--bads:#3b2420;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35)}}
[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
header{position:sticky;top:0;z-index:5;background:var(--bg);padding:14px 16px 8px}
.top{display:flex;align-items:center;gap:12px}.top svg{width:38px;height:38px;flex:none}
.top b{display:block;font:600 19px/1.15 Georgia,'Times New Roman',serif;color:var(--strong)}.top .k{display:block}
.live{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:14px;color:var(--muted)}.live i{width:8px;height:8px;border-radius:50%;background:var(--good)}
#team{display:flex;gap:8px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}#team:empty{display:none}
.tc{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);border-radius:99px;padding:4px 10px 4px 4px;font-size:14px;white-space:nowrap;flex:none}
.av{width:24px;height:24px;border-radius:7px;display:inline-grid;place-items:center;font:600 11px/1 system-ui,sans-serif;color:#fff;flex:none}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;background:var(--faint)}.dot.work{background:var(--accent);box-shadow:0 0 0 3px var(--soft)}.dot.ok{background:var(--good)}.dot.wait{background:var(--warn)}.dot.bad{background:var(--bad)}.dot.off{background:transparent;border:1.5px solid var(--faint)}
main{padding:6px 16px 170px}.k{color:var(--muted);font-size:13.5px}
h3{margin:18px 0 8px;font:500 17px/1.3 Georgia,serif;color:var(--strong)}
.card{background:var(--card);border:1px solid var(--line2);border-radius:18px;margin-bottom:12px;box-shadow:var(--shadow);overflow:hidden}
.card .in{padding:14px 16px}.card .w{font-weight:600;color:var(--strong)}.card .y{color:var(--muted);font-size:14px;margin-top:2px}
.facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.pill{font-size:13px;padding:2px 10px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}.pill.g{background:var(--goods);color:var(--good);border-color:transparent}
.ft{display:flex;gap:10px;padding:12px 16px;background:var(--sunk);border-top:1px solid var(--line)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.btn{flex:1;min-height:46px;border-radius:12px;border:1px solid var(--line2);background:var(--card);color:var(--strong);font:500 16px system-ui,sans-serif;padding:8px 12px}
.btn.p{background:var(--accent);color:var(--ink);border-color:var(--accent)}.btn.d{color:var(--bad)}.btn:disabled{opacity:.6}
.msg{margin:0 0 20px}.msg .who{display:flex;align-items:center;gap:9px;font-size:15px;margin-bottom:6px}.msg .who b{color:var(--strong)}
.msg .tx{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16.5px;line-height:1.55}
.me{display:flex;justify-content:flex-end}.me .tx{background:var(--sunk);border:1px solid var(--line);border-radius:20px;padding:12px 16px;max-width:86%}
.sys{text-align:center;font-size:13.5px;color:var(--faint);margin:0 0 18px}
#bar{position:fixed;left:10px;right:10px;bottom:calc(72px + env(safe-area-inset-bottom));background:var(--card);border:1px solid var(--line2);border-radius:22px;box-shadow:var(--shadow);padding:10px 10px 10px 16px;display:flex;gap:8px;align-items:center;z-index:6}
#bar input{flex:1;min-width:0;background:transparent;color:var(--text);border:0;outline:none;font:16.5px system-ui,sans-serif;padding:8px 0}
#send{width:46px;height:46px;border-radius:13px;border:0;background:var(--accent);color:var(--ink);display:grid;place-items:center;flex:none}#send svg{width:22px;height:22px}
#tabs{position:fixed;left:0;right:0;bottom:0;z-index:7;background:var(--side);border-top:1px solid var(--line);display:flex;padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
#tabs button{flex:1;background:none;border:0;color:var(--muted);font:500 13px system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;position:relative}
#tabs button svg{width:24px;height:24px}#tabs button.on{color:var(--strong)}
#tabs .n{position:absolute;top:0;left:calc(50% + 4px);background:var(--accent);color:var(--ink);border-radius:99px;font-size:11px;font-weight:700;padding:0 6px}
svg.i{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.note{position:sticky;top:0;z-index:8;background:var(--accent);color:var(--ink);padding:10px 16px;font-weight:600}.empty{color:var(--muted);padding:6px 0}
input.code{font-size:30px;letter-spacing:10px;width:100%;text-align:center;background:var(--card);color:var(--text);border:1px solid var(--line2);border-radius:14px;padding:12px}
.field{flex:1;padding:12px;background:var(--card);color:var(--text);border:1px solid var(--line2);border-radius:12px;font:16px system-ui,sans-serif}
</style></head><body>
<div id="note" class="note" hidden></div>
<header><div class="top"><svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d17"/><stop offset="1" stop-color="#140f0d"/></linearGradient><linearGradient id="fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e2361f"/><stop offset=".55" stop-color="#ff5d5d"/><stop offset="1" stop-color="#fda74e"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/><path d="M256 92c18 58 92 100 92 186 0 64-44 116-92 116s-92-52-92-116c0-46 22-78 44-104 4 30 18 50 36 58-6-58 2-106 12-140z" fill="url(#fl)"/><rect x="150" y="410" width="212" height="18" rx="9" fill="#954433"/></svg>
<div><b>Hearth AI</b><span id="dev" class="k"></span></div><span class="live"><i></i>Live</span></div>
<div id="team"></div></header>
<main id="main"></main>
<div id="bar" hidden><input id="msg" placeholder="Message the team…" enterkeyhint="send" autocomplete="off"><button id="send" aria-label="Send"><svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg></button></div>
<nav id="tabs"><button data-tab="chat"><svg class="i" viewBox="0 0 24 24"><path d="M4 5h16v11H10l-6 4z"/></svg>Chat</button><button data-tab="board"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/></svg>Board</button><button data-tab="wait" class="on"><svg class="i" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>Approvals<span id="cnt" class="n" hidden></span></button></nav>
<script>
const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let tab='wait',snap=null,seen=null;
const MONO={anthropic:['C','#b9772e'],openai:['G','#3f8a6b'],google:['Ge','#4a73b5'],xai:['X','#5d5a57'],mistral:['M','#b8613a'],qwen:['Q','#6a5fb5'],perplexity:['P','#2f7f8f'],deepseek:['D','#4a5fb0'],ollama:['L','#2f8a8a'],freebuff:['F','#8a5aa8'],free:['Fr','#3f8a5a'],copilot:['Co','#3d8a63'],meta:['Me','#3b6fc0']};
const av=(id)=>{const m=MONO[id]||[String(n(id)||'?').slice(0,1),'#7a7166'];return '<span class="av" style="background:'+m[1]+'">'+esc(m[0])+'</span>';};
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Hearth':'1'},body:JSON.stringify(body),credentials:'same-origin'}:{credentials:'same-origin'});return r.json().catch(()=>({ok:false}));}
function pairView(msg){document.getElementById('tabs').hidden=true;document.getElementById('bar').hidden=true;
document.getElementById('main').innerHTML='<div class="card"><div class="in"><p>Enter the 6-digit code shown in the app (Settings › Phone view, or the Project page).</p><input class="code" id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><div class="row"><input id="name" class="field" placeholder="Name for this phone"><button class="btn p" id="pair" style="flex:none">Pair</button></div><p class="k">'+esc(msg||'')+'</p></div></div>';
document.getElementById('pair').onclick=async()=>{const r=await api('/api/pair',{code:document.getElementById('code').value,name:document.getElementById('name').value});if(r.ok)load();else pairView(r.message);};}
const n=(id)=>snap&&snap.names&&snap.names[id]||id;
let lastHtml='';
const typing=()=>{const i=document.getElementById('msg');return document.activeElement===i||(i&&i.value.trim()!=='');};
const atBottom=()=>window.innerHeight+window.scrollY>=document.body.scrollHeight-80;
function chrome(){document.getElementById('tabs').hidden=false;document.getElementById('bar').hidden=tab!=='chat';document.getElementById('dev').textContent=(snap.project||'')+' · '+(snap.device||'');
document.querySelectorAll('#tabs button').forEach((b)=>b.classList.toggle('on',b.dataset.tab===tab));
const w=snap.waiting||{permissions:[],approvals:[],cards:[]};const c=(w.permissions||[]).length+(w.approvals||[]).length+(w.cards||[]).length;const cnt=document.getElementById('cnt');if(cnt){cnt.hidden=!c;cnt.textContent=c;}
const team=document.getElementById('team');if(team)team.innerHTML=(snap.team||[]).map((m)=>'<span class="tc">'+av(m.id)+esc(n(m.id))+(m.lead?' ★':'')+'<span class="dot '+esc(m.dot)+'"></span></span>').join('');}
function render(force){if(!snap)return;chrome();
const w=snap.waiting||{permissions:[],approvals:[],cards:[]};let h='';
if(tab==='wait'){h+='<h3>Permission requests</h3>'+(w.permissions.map((p)=>'<div class="card"><div class="in"><div class="w">'+esc(p.what)+'</div><div class="y">'+esc(n(p.agent))+' · R-'+esc(p.id)+' · '+esc(p.kind)+'</div>'+(p.why?'<div class="y">Why: '+esc(p.why)+'</div>':'')+'</div><div class="ft">'+(p.computerOnly?'<span class="k" style="flex:1;align-self:center">Approve this on the computer.</span>':'<button class="btn p" data-a="decide" data-id="'+esc(p.id)+'" data-v="approved">Approve</button>')+'<button class="btn d" data-a="decide" data-id="'+esc(p.id)+'" data-v="denied">Deny</button></div></div>').join('')||'<div class="empty">None.</div>');
h+='<h3>Tasks for your approval</h3>'+(w.approvals.map((t)=>'<div class="card"><div class="in"><div class="w">Approve T-'+esc(t.id)+'?</div><div class="y">'+esc(t.title)+'</div><div class="facts"><span class="pill">by '+esc(n(t.assignee))+'</span><span class="pill'+(t.tests==='tests passed'?' g':'')+'">'+esc(t.tests||'tests not run')+'</span></div></div><div class="ft"><button class="btn p" data-a="approve" data-id="'+esc(t.id)+'">Approve</button><button class="btn" data-a="changes" data-id="'+esc(t.id)+'">Request changes</button></div><div class="k" style="padding:0 16px 10px;background:var(--sunk)">Merging stays on the computer.</div></div>').join('')||'<div class="empty">None.</div>');
h+='<h3>Questions for you</h3>'+(w.cards.map((c)=>'<div class="card"><div class="in"><div class="w">'+esc(c.text)+'</div></div><div class="ft">'+c.options.map((o)=>'<button class="btn'+(o.primary?' p':'')+'" data-a="card" data-id="'+esc(c.id)+'" data-v="'+esc(o.value)+'">'+esc(o.label)+'</button>').join('')+'</div></div>').join('')||'<div class="empty">None.</div>');}
if(tab==='board'){h+=(snap.board||[]).map((c)=>'<h3>'+esc(c.title)+' <span class="k">'+c.tasks.length+'</span></h3>'+c.tasks.map((t)=>'<div class="card"><div class="in"><div class="w">'+esc(t.title)+'</div><div class="y">T-'+esc(t.id)+' · '+esc(n(t.assignee))+(t.ci?' · CI '+esc(t.ci):'')+'</div>'+(t.canStart?'<div class="row"><button class="btn p" data-a="start" data-id="'+esc(t.id)+'">'+esc(t.canStart)+'</button></div>':'')+'</div></div>').join('')).join('');}
if(tab==='chat'){h+=(snap.chat||[]).map((m)=>m.who==='owner'?'<div class="msg me"><div class="tx">'+esc(m.text)+'</div></div>':m.who==='system'?'<div class="sys">'+esc(m.text)+'</div>':'<div class="msg"><div class="who">'+av(m.who)+'<b>'+esc(n(m.who))+'</b> <span class="k">'+esc((m.at||'').slice(11,16))+'</span></div><div class="tx">'+esc(m.text)+'</div></div>').join('')||'<div class="empty">No messages.</div>';}
if(!force&&h===lastHtml)return;const stick=tab==='chat'&&(force||atBottom());lastHtml=h;document.getElementById('main').innerHTML=h;if(stick&&!typing())window.scrollTo(0,document.body.scrollHeight);}
function notify(){const w=snap.waiting||{};const ids=[...(w.permissions||[]).map((p)=>'R'+p.id),...(w.approvals||[]).map((t)=>'T'+t.id),...(w.cards||[]).map((c)=>'C'+c.id)];
const fresh=seen?ids.filter((i)=>!seen.has(i)):[];seen=new Set(ids);document.title=(ids.length?'('+ids.length+') ':'')+'Hearth AI';
const el=document.getElementById('note');if(fresh.length){el.hidden=false;el.textContent=fresh.length+' new item'+(fresh.length>1?'s':'')+' waiting for you';if(navigator.vibrate)navigator.vibrate(200);
try{if(window.Notification&&Notification.permission==='granted')new Notification('Hearth AI',{body:el.textContent});}catch(e){}setTimeout(()=>{el.hidden=true;},8000);}}
async function load(){const r=await api('/api/state');if(r.pair)return pairView('');if(!r.ok)return;snap=r;notify();if(tab==='chat'&&typing())return;render();}
document.addEventListener('click',async(e)=>{const t=e.target.closest('[data-tab]');if(t){tab=t.dataset.tab;return render(true);}
const b=e.target.closest('[data-a]');if(!b)return;b.disabled=true;const r=await api('/api/action',{type:b.dataset.a,id:b.dataset.id,value:b.dataset.v});b.textContent=r.ok?'Sent':'Failed';setTimeout(load,1200);});
async function sendMsg(){const i=document.getElementById('msg');const v=i.value;if(!v.trim())return;i.value='';i.focus();const r=await api('/api/action',{type:'chat',value:v});if(!r.ok){i.value=v;return;}setTimeout(async()=>{await load();render(true);},1200);}
document.getElementById('send').addEventListener('pointerdown',(e)=>e.preventDefault());
document.getElementById('send').onclick=sendMsg;
document.getElementById('msg').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();sendMsg();}});
document.getElementById('msg').addEventListener('blur',()=>setTimeout(()=>{if(!typing())render();},300));
load();setInterval(load,5000);
</script></body></html>`;

module.exports = { PHONE_HTML };
