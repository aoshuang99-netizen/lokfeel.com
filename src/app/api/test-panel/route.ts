import { NextResponse } from 'next/server';

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin V3.6 — 功能测试面板</title>
<style>
:root { --bg:#f5f5f7; --card:#fff; --text:#1d1d1f; --text2:#6e6e73; --text3:#86868b; --blue:#0071e3; --green:#34c759; --red:#ff3b30; --orange:#ff9500; --border:#e5e5e7; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,sans-serif; background:var(--bg); color:var(--text); padding:24px; }
h1 { font-size:22px; font-weight:700; margin-bottom:4px; }
.sub { color:var(--text3); font-size:13px; margin-bottom:16px; }
.controls { display:flex; gap:8px; margin:16px 0; flex-wrap:wrap; }
.btn { padding:7px 15px; border-radius:10px; border:1px solid var(--border); background:var(--card); font-size:12px; font-weight:500; cursor:pointer; }
.btn-primary { background:var(--blue); color:#fff; border:none; }
.btn:hover { border-color:var(--blue); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
.card { background:var(--card); border-radius:12px; border:1px solid var(--border); padding:16px; }
.card h3 { font-size:13px; font-weight:600; margin-bottom:6px; }
.url { font-size:10px; color:var(--text3); font-family:monospace; margin-bottom:4px; }
.result { padding:10px; border-radius:8px; font-size:11px; margin-top:8px; white-space:pre-wrap; word-break:break-all; }
.result.pending { background:#f5f5f7; border:1px dashed #ccc; }
.result.ok { background:#f0fff4; color:#1a7a30; border:1px solid #34c75930; }
.result.err { background:#fff0f0; color:#991b1b; border:1px solid #ff3b3030; }
.summary { display:flex; gap:10px; margin-bottom:16px; }
.summary-card { background:var(--card); border-radius:12px; border:1px solid var(--border); padding:12px 18px; text-align:center; }
.summary-card .num { font-size:24px; font-weight:700; }
.summary-card .lbl { font-size:10px; color:var(--text3); }
.badge { display:inline-block; padding:1px 6px; border-radius:4px; font-size:9px; background:#34c75915; color:var(--green); }
</style>
</head>
<body>
<h1>Admin V3.6 — 功能测试面板</h1>
<p class="sub">V3.6: 漏斗分析+留存分析+实时监控+告警系统 | 2026-05-16</p>
<div class="summary" id="summary">
  <div class="summary-card"><div class="num" style="color:#34c759" id="pass">0</div><div class="lbl">✅ 通过</div></div>
  <div class="summary-card"><div class="num" style="color:#ff3b30" id="fail">0</div><div class="lbl">❌ 失败</div></div>
  <div class="summary-card"><div class="num" id="total">0</div><div class="lbl">📊 总计</div></div>
</div>
<div class="controls">
  <button class="btn btn-primary" onclick="runAll()">▶ 运行全部测试</button>
  <button class="btn" onclick="testLogin()">🔐 登录</button>
  <button class="btn" onclick="testPages()">📄 页面</button>
  <button class="btn" onclick="testAPIs()">🔌 API</button>
</div>
<div class="grid" id="grid"></div>
<script>
const BASE = 'https://nexus-app-kohl.vercel.app';
const ADMIN = { user: 'admin@nexus.app', pass: 'admin123' };
const R = {};
const TESTS = [
  {id:'P01',name:'登录页面',url:'/admin/login',m:'GET'},
  {id:'P02',name:'仪表盘',url:'/admin',m:'REDIRECT'},
  {id:'P03',name:'数据分析',url:'/admin/analytics',m:'REDIRECT'},
  {id:'P04',name:'漏斗分析',url:'/admin/analytics/funnel',m:'REDIRECT',x:'NEW'},
  {id:'P05',name:'留存分析',url:'/admin/analytics/retention',m:'REDIRECT',x:'NEW'},
  {id:'P06',name:'实时监控',url:'/admin/analytics/realtime',m:'REDIRECT',x:'NEW'},
  {id:'P07',name:'告警系统',url:'/admin/alerts',m:'REDIRECT',x:'NEW'},
  {id:'A01',name:'登录API',url:'/api/admin/login',m:'LOGIN'},
  {id:'A02',name:'仪表盘数据',url:'/api/admin/dashboard/summary',m:'AUTH'},
  {id:'A03',name:'用户列表',url:'/api/admin/users?pageSize=3',m:'AUTH'},
  {id:'A04',name:'会话检查',url:'/api/admin/session',m:'AUTH'},
];
TESTS.forEach(t => { R[t.id]='pending'; const d=document.createElement('div'); d.className='card'; d.innerHTML='<h3>'+t.name+(t.x?' <span class="badge">NEW</span>':'')+'</h3><div class="url">'+t.m+' '+t.url+'</div><div class="result pending" id="r-'+t.id+'">等待测试...</div>'; document.getElementById('grid').appendChild(d); });
document.getElementById('total').textContent = TESTS.length;
function setResult(id, status, msg) {
  R[id] = status;
  const el = document.getElementById('r-'+id);
  if(el){ el.textContent = msg; el.className = 'result ' + (status==='pass'?'ok':'err'); }
  updateSummary();
}
function updateSummary() {
  document.getElementById('pass').textContent = TESTS.filter(t=>R[t.id]==='pass').length;
  document.getElementById('fail').textContent = TESTS.filter(t=>R[t.id]==='err').length;
}
async function testLogin() {
  setResult('A01','pending','登录中...');
  try {
    const res = await fetch(BASE+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ADMIN),credentials:'include'});
    const d = await res.json().catch(()=>({}));
    if(res.status===200&&d.success){ setResult('A01','pass','✅ 登录成功: '+d.user?.role); return true; }
    else { setResult('A01','err','❌ 失败:'+res.status); return false; }
  } catch(e){ setResult('A01','err','❌ 网络错误:'+e.message); return false; }
}
async function testPages() {
  for(const t of TESTS.filter(t=>t.id.startsWith('P'))){
    setResult(t.id,'pending','测试中...');
    try {
      const res = await fetch(BASE+t.url,{credentials:'include',redirect:'manual'});
      const s = res.status;
      if(s===200||s===307||s===302){ setResult(t.id,'pass','✅ HTTP '+s); }
      else if(s===401||s===403){ setResult(t.id,'pass','✅ 需要认证:'+s); }
      else { setResult(t.id,'err','❌ HTTP '+s); }
    } catch(e){ setResult(t.id,'err','❌ '+e.message); }
  }
}
async function testAPIs() {
  for(const t of TESTS.filter(t=>t.id.startsWith('A')&&t.m!=='LOGIN')){
    setResult(t.id,'pending','测试中...');
    try {
      const res = await fetch(BASE+t.url,{credentials:'include'});
      const d = await res.json().catch(()=>null);
      if(res.status===200&&d?.success){ setResult(t.id,'pass','✅ OK'); }
      else if(res.status===401){ setResult(t.id,'err','⚠️ 未登录:'+res.status); }
      else { setResult(t.id,'err','❌ '+res.status); }
    } catch(e){ setResult(t.id,'err','❌ '+e.message); }
  }
}
async function runAll() { await testLogin(); await testPages(); await testAPIs(); }
</script>
</body>
</html>`;

export async function GET() {
  return new NextResponse(HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
