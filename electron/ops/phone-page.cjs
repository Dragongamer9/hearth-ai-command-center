// The phone page (served only on the local network by phone.cjs). Self-contained:
// no external scripts, fonts or services. Everything shown is escaped.
const PHONE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hearth AI on your phone</title>
<style>
:root{--bg:#171a21;--panel:#1f2430;--line:#2c3342;--text:#d6dbe4;--muted:#8a93a3;--accent:#66c0f4;--warn:#e5b04a;--good:#5fbf77;--bad:#e06c6c}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--text)}
header{position:sticky;top:0;background:#12151b;border-bottom:1px solid var(--line);padding:10px 14px;display:flex;gap:8px;align-items:center}
header b{flex:1}nav{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--line)}
nav button,.btn{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:7px 11px;font:inherit}
nav button.on{border-color:var(--accent);color:var(--accent)}.btn.p{background:var(--accent);color:#0b1520;border-color:var(--accent)}.btn.d{color:var(--bad)}
main{padding:12px 14px 90px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:10px}
.k{color:var(--muted);font-size:12.5px}.row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}h3{margin:14px 0 8px;font-size:14px;color:var(--muted)}
.msg{padding:6px 0;border-bottom:1px solid var(--line)}.msg b{color:var(--accent)}#bar{position:fixed;left:0;right:0;bottom:0;background:#12151b;border-top:1px solid var(--line);padding:8px;display:flex;gap:6px}
#bar input{flex:1;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:9px;font:inherit}
.note{background:var(--warn);color:#10161d;padding:8px 12px;font-weight:600}.empty{color:var(--muted);padding:6px 0}
input.code{font-size:28px;letter-spacing:8px;width:100%;text-align:center;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px}
</style></head><body>
<header><b>Hearth AI</b><span id="dev" class="k"></span></header>
<div id="note" class="note" hidden></div>
<nav id="tabs"><button data-tab="wait" class="on">Waiting</button><button data-tab="board">Board</button><button data-tab="chat">Chat</button></nav>
<main id="main"></main>
<div id="bar" hidden><input id="msg" placeholder="Message the team"><button class="btn p" id="send">Send</button></div>
<script>
const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let tab='wait',snap=null,seen=null;
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Hearth':'1'},body:JSON.stringify(body),credentials:'same-origin'}:{credentials:'same-origin'});return r.json().catch(()=>({ok:false}));}
function pairView(msg){document.getElementById('tabs').hidden=true;document.getElementById('bar').hidden=true;
document.getElementById('main').innerHTML='<div class="card"><p>Enter the 6-digit code shown in the app (Project page, Your phone).</p><input class="code" id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><div class="row"><input id="name" placeholder="Name for this phone" style="flex:1;padding:8px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px"><button class="btn p" id="pair">Pair</button></div><p class="k">'+esc(msg||'')+'</p></div>';
document.getElementById('pair').onclick=async()=>{const r=await api('/api/pair',{code:document.getElementById('code').value,name:document.getElementById('name').value});if(r.ok)load();else pairView(r.message);};}
const n=(id)=>snap&&snap.names&&snap.names[id]||id;
function render(){if(!snap)return;document.getElementById('tabs').hidden=false;document.getElementById('bar').hidden=tab!=='chat';document.getElementById('dev').textContent=(snap.project||'')+' · '+(snap.device||'');
document.querySelectorAll('#tabs button').forEach((b)=>b.classList.toggle('on',b.dataset.tab===tab));
const w=snap.waiting||{permissions:[],approvals:[],cards:[]};let h='';
if(tab==='wait'){h+='<h3>Permission requests</h3>'+(w.permissions.map((p)=>'<div class="card"><div class="k">'+esc(n(p.agent))+' · R-'+esc(p.id)+' · '+esc(p.kind)+'</div>'+esc(p.what)+(p.why?'<div class="k">Why: '+esc(p.why)+'</div>':'')+'<div class="row">'+(p.computerOnly?'<span class="k">Approve this on the computer.</span>':'<button class="btn p" data-a="decide" data-id="'+esc(p.id)+'" data-v="approved">Approve</button>')+'<button class="btn d" data-a="decide" data-id="'+esc(p.id)+'" data-v="denied">Deny</button></div></div>').join('')||'<div class="empty">None.</div>');
h+='<h3>Tasks for your approval</h3>'+(w.approvals.map((t)=>'<div class="card"><div class="k">T-'+esc(t.id)+' · by '+esc(n(t.assignee))+' · '+esc(t.tests||'tests not run')+'</div>'+esc(t.title)+'<div class="row"><button class="btn p" data-a="approve" data-id="'+esc(t.id)+'">Approve (merge stays on the computer)</button><button class="btn" data-a="changes" data-id="'+esc(t.id)+'">Request changes</button></div></div>').join('')||'<div class="empty">None.</div>');
h+='<h3>Questions for you</h3>'+(w.cards.map((c)=>'<div class="card">'+esc(c.text)+'<div class="row">'+c.options.map((o)=>'<button class="btn'+(o.primary?' p':'')+'" data-a="card" data-id="'+esc(c.id)+'" data-v="'+esc(o.value)+'">'+esc(o.label)+'</button>').join('')+'</div></div>').join('')||'<div class="empty">None.</div>');}
if(tab==='board'){h+=(snap.board||[]).map((c)=>'<h3>'+esc(c.title)+' ('+c.tasks.length+')</h3>'+c.tasks.map((t)=>'<div class="card"><div class="k">T-'+esc(t.id)+' · '+esc(n(t.assignee))+(t.ci?' · CI '+esc(t.ci):'')+'</div>'+esc(t.title)+(t.canStart?'<div class="row"><button class="btn p" data-a="start" data-id="'+esc(t.id)+'">'+esc(t.canStart)+'</button></div>':'')+'</div>').join('')).join('');}
if(tab==='chat'){h+=(snap.chat||[]).map((m)=>'<div class="msg"><b>'+esc(n(m.who))+'</b> <span class="k">'+esc((m.at||'').slice(11,16))+'</span><div>'+esc(m.text)+'</div></div>').join('')||'<div class="empty">No messages.</div>';}
document.getElementById('main').innerHTML=h;if(tab==='chat')window.scrollTo(0,document.body.scrollHeight);}
function notify(){const w=snap.waiting||{};const ids=[...(w.permissions||[]).map((p)=>'R'+p.id),...(w.approvals||[]).map((t)=>'T'+t.id),...(w.cards||[]).map((c)=>'C'+c.id)];
const fresh=seen?ids.filter((i)=>!seen.has(i)):[];seen=new Set(ids);document.title=(ids.length?'('+ids.length+') ':'')+'Hearth AI';
const el=document.getElementById('note');if(fresh.length){el.hidden=false;el.textContent=fresh.length+' new item'+(fresh.length>1?'s':'')+' waiting for you';if(navigator.vibrate)navigator.vibrate(200);
try{if(window.Notification&&Notification.permission==='granted')new Notification('Hearth AI',{body:el.textContent});}catch(e){}setTimeout(()=>{el.hidden=true;},8000);}}
async function load(){const r=await api('/api/state');if(r.pair)return pairView('');if(!r.ok)return;snap=r;notify();render();}
document.addEventListener('click',async(e)=>{const t=e.target.closest('[data-tab]');if(t){tab=t.dataset.tab;return render();}
const b=e.target.closest('[data-a]');if(!b)return;b.disabled=true;const r=await api('/api/action',{type:b.dataset.a,id:b.dataset.id,value:b.dataset.v});b.textContent=r.ok?'Sent':'Failed';setTimeout(load,1200);});
document.getElementById('send').onclick=async()=>{const i=document.getElementById('msg');if(!i.value.trim())return;await api('/api/action',{type:'chat',value:i.value});i.value='';setTimeout(load,1200);};
load();setInterval(load,5000);
</script></body></html>`;

module.exports = { PHONE_HTML };
