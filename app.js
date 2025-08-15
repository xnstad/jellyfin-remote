// ===================== JellyRemote PWA — CLEAN + LOGGING =====================

// ---------- Logger ----------
const LOG = true;
function log(...args){ if (LOG) console.log(`[JF] ${new Date().toISOString()}`, ...args); }
function uiInfo(msg){ const n = document.getElementById('opStatus'); if (n) n.innerHTML = msg; }
function uiErr(prefix, e){
  const n = document.getElementById('opStatus'); 
  const txt = (e && e.message) ? e.message : String(e);
  if (n) n.innerHTML = `<span class="err">${prefix || 'Error'}:</span> ${txt}`;
  log('ERR', prefix, e);
}

window.addEventListener('error', ev => uiErr('JS error', ev.error || ev.message));
window.addEventListener('unhandledrejection', ev => uiErr('Unhandled promise', ev.reason));

// ---------- Elements ----------
const els = {
  // header/sheet
  btnSettings: document.getElementById('btnSettings'),
  sheet: document.getElementById('sheet'),
  sheetClose: document.getElementById('sheetClose'),
  sheetCloseBtn: document.getElementById('sheetCloseBtn'),

  // settings fields
  serverUrl: document.getElementById('serverUrl'),
  token: document.getElementById('token'),
  deviceId: document.getElementById('deviceId'),
  clientName: document.getElementById('clientName'),
  bridgeUrl: document.getElementById('bridgeUrl'),
  bridgeSecret: document.getElementById('bridgeSecret'),
  save: document.getElementById('save'),
  test: document.getElementById('test'),
  status: document.getElementById('status'),
  pollMs: document.getElementById('pollMs'),

  // sessions
  sessionSelect: document.getElementById('sessionSelect'),
  refreshSessions: document.getElementById('refreshSessions'),
  useBridge: document.getElementById('useBridge'),

  // now playing
  art: document.getElementById('art'),
  npTitle: document.getElementById('npTitle'),
  npSub: document.getElementById('npSub'),
  tCur: document.getElementById('tCur'),
  tDur: document.getElementById('tDur'),
  seekRange: document.getElementById('seekRange'),

  // controls
  btnVolDown: document.getElementById('btnVolDown'),
  btnPrev: document.getElementById('btnPrev'),
  btnToggle: document.getElementById('btnToggle'),
  btnNext: document.getElementById('btnNext'),
  btnVolUp: document.getElementById('btnVolUp'),
  iconToggle: document.getElementById('iconToggle'),

  // misc
  btnRefreshMeta: document.getElementById('btnRefreshMeta'),
  opStatus: document.getElementById('opStatus'),
};

// ---------- SW ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(r=>log('SW registered', r.scope)).catch(e=>log('SW reg failed', e));
}



// ---------- State ----------
let sessionCache = new Map();
let __lastItemId = null;
let pollTimer = null;

// ---------- Service Worker -----------
let wsHealthy = false;

// When the socket opens, pause REST polling (WS will drive updates)
window.addEventListener('jfws:open', () => {
  wsHealthy = true;
  log('WS open → pause polling');
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
});

// If socket closes, resume polling as a fallback
window.addEventListener('jfws:close', () => {
  wsHealthy = false;
  log('WS closed → resume polling');
  startPolling();
});

// On pushed Sessions, refresh cache + UI (no extra fetch)
window.addEventListener('jfws:sessions', (ev) => {
  try {
    const list = ev.detail || [];
    sessionCache = new Map(list.map(s => [s.Id, s]));
    fetchAndRenderNowPlaying(false).catch(e => uiErr('WS render', e));
  } catch (e) {
    uiErr('WS sessions handler', e);
  }
});


// ---------- Defaults / Config ----------
const defaults = { clientName:'JellyRemote PWA', pollMs:2000, bridgeUrl:'', bridgeSecret:'' };

function makeUUID(){
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function getCfg(){
  const raw = JSON.parse(localStorage.getItem('jf_remote_cfg') || '{}');
  if (!raw.deviceId) { raw.deviceId = makeUUID(); localStorage.setItem('jf_remote_cfg', JSON.stringify(raw)); }
  return Object.assign({}, defaults, raw);
}
function setCfg(newCfg){
  localStorage.setItem('jf_remote_cfg', JSON.stringify(newCfg));
  return newCfg;
}

// ---------- Settings sheet helpers (iOS-safe inline hooks) ----------
window.__openSettings  = function(){
  const c = getCfg();
  els.serverUrl.value   = c.serverUrl || '';
  els.token.value       = c.token || '';
  els.deviceId.value    = c.deviceId;
  els.clientName.value  = c.clientName || defaults.clientName;
  els.bridgeUrl.value   = c.bridgeUrl || '';
  els.bridgeSecret.value= c.bridgeSecret || '';
  els.pollMs.value      = c.pollMs || defaults.pollMs;
  els.sheet?.classList.add('open');
  if (location.hash !== '#sheet') history.replaceState(null,'','#sheet');
};
window.__closeSettings = function(){
  els.sheet?.classList.remove('open');
  if (location.hash) history.replaceState(null,'',' ');
};

window.__saveSettings = function(){
  const prev = getCfg();
  const c = {
    serverUrl: els.serverUrl.value.trim().replace(/\/$/, ''),
    token: els.token.value.trim(),
    deviceId: (els.deviceId.value || prev.deviceId).trim() || makeUUID(),
    clientName: els.clientName.value.trim() || defaults.clientName,
    pollMs: parseInt(els.pollMs.value, 10) || defaults.pollMs,
    sessionId: els.sessionSelect?.value || null,
    bridgeUrl: els.bridgeUrl.value.trim().replace(/\/$/, ''),
    bridgeSecret: els.bridgeSecret.value.trim(),
    forceBridge: !!els.useBridge?.checked
  };
  setCfg(c);
  if (els.status){ els.status.textContent = 'Saved.'; setTimeout(()=> els.status.textContent='', 1200); }
  log('Saved cfg', c);
  window.JFWS?.stop?.();
  window.JFWS?.connect?.();
  startPolling(); // apply new interval immediately
};

window.__testConnection = async function(){
  try {
    const sys = await jfGet('/System/Info/Public');
    els.status.innerHTML = `Connected to <span class="ok">${sys.ServerName}</span> (v${sys.Version})`;
    log('Test OK', sys);
  } catch (e) {
    els.status.innerHTML = `<span class="err">Connection failed:</span> ${e.message}`;
    log('Test FAIL', e);
  }
};

// ---------- HTTP helpers ----------
function authHeader(cfg) {
  const auth = `MediaBrowser Client="${cfg.clientName||'JellyRemote PWA'}", Device="PWA", DeviceId="${cfg.deviceId}", Version="1.0.0", Token="${cfg.token}"`;
  return { 'Authorization': auth, 'X-Emby-Authorization': auth };
}

async function jfGet(path) {
  const c = getCfg();
  const url = `${c.serverUrl}${path}`;
  log('GET', url);
  const r = await fetch(url, { headers: authHeader(c), cache:'no-store' });
  if (!r.ok) { const t = await r.text().catch(()=>r.statusText); throw new Error(`${r.status} ${t}`); }
  return r.json();
}

async function jfPost(path, body) {
  const c = getCfg();
  const url = `${c.serverUrl}${path}`;
  log('POST', url, body||null);
  const r = await fetch(url, { method:'POST', headers: { ...authHeader(c), 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : null });
  if (!r.ok && r.status !== 204) { const t = await r.text().catch(()=>r.statusText); throw new Error(`${r.status} ${t}`); }
  return r;
}

async function bridgePost(path){
  const c = getCfg();
  if (!c.bridgeUrl) throw new Error('Bridge URL not set');
  const url = c.bridgeUrl + path;
  log('BRIDGE POST', url);
  const r = await fetch(url, { method:'POST', headers:{ 'X-Secret': c.bridgeSecret || '' }});
  if (!r.ok) { const t = await r.text().catch(()=>r.statusText); throw new Error(`${r.status} ${t}`); }
  return r;
}

function isLikelyFinamp(s){ const name = `${s?.Client||''} ${s?.DeviceName||''}`.toLowerCase(); return name.includes('finamp'); }
function shouldUseBridge(){
  const c = getCfg();
  const s = c.sessionId ? sessionCache.get(c.sessionId) : null;
  return !!c.forceBridge || !s?.SupportsMediaControl || isLikelyFinamp(s);
}

// ---------- Sessions ----------
async function fetchSessionsSmart(){
  // 1) try plain
  try {
    const list = await jfGet(`/Sessions?t=${Date.now()}`);
    if (Array.isArray(list) && list.length) return list;
  } catch (e) { log('Sessions base failed', e); }

  // 2) try controllable-by current user
  try {
    const me = await jfGet('/Users/Me');
    if (me?.Id) {
      const list = await jfGet(`/Sessions?ControllableByUserId=${me.Id}&ActiveWithinSeconds=86400&t=${Date.now()}`);
      if (Array.isArray(list) && list.length) return list;
    }
  } catch (e) { log('Sessions controllable failed', e); }

  // 3) fallback: recently active
  try {
    const list = await jfGet(`/Sessions?ActiveWithinSeconds=86400&t=${Date.now()}`);
    if (Array.isArray(list)) return list;
  } catch (e) { log('Sessions recent failed', e); }

  return [];
}

async function loadSessions(){
  const cfg = getCfg();
  els.sessionSelect.innerHTML = '<option>Loading…</option>';
  try {
    const sessions = await fetchSessionsSmart();
    log('Sessions fetched', sessions.length);

    sessionCache = new Map(sessions.map(s => [s.Id, s]));
    sessions.sort((a,b)=> (b.NowPlayingItem?1:0) - (a.NowPlayingItem?1:0));

    els.sessionSelect.innerHTML = '';
    if (!sessions.length){
      const opt = document.createElement('option');
      opt.textContent = 'No sessions visible for this token';
      els.sessionSelect.appendChild(opt);
      setCfg({ ...cfg, sessionId:null });
      applyModeUI();
      return;
    }

    for (const s of sessions){
      const opt = document.createElement('option');
      const label = `${s.DeviceName || s.Client || 'Unknown'} — ${s.UserName || 'User'}${s.NowPlayingItem ? ' • ▶ ' + (s.NowPlayingItem.Name||'') : ''}`;
      opt.value = s.Id; opt.textContent = label;
      els.sessionSelect.appendChild(opt);
    }

    let picked = cfg.sessionId && sessions.find(x=>x.Id===cfg.sessionId)?.Id;
    if (!picked) picked = (sessions.find(x=>x.NowPlayingItem)?.Id) || sessions[0].Id;
    els.sessionSelect.value = picked;
    setCfg({ ...cfg, sessionId: picked });
    applyModeUI();
    log('Session selected', picked);
  } catch (e) {
    const opt = document.createElement('option');
    opt.textContent = `Error: ${e.message}`;
    els.sessionSelect.innerHTML = ''; els.sessionSelect.appendChild(opt);
    uiErr('Load sessions', e);
  }
}

els.refreshSessions?.addEventListener('click', ()=> { log('Refresh sessions click'); loadSessions(); });
els.sessionSelect?.addEventListener('change', ()=>{
  const cfg = getCfg();
  const picked = els.sessionSelect.value || null;
  setCfg({ ...cfg, sessionId: picked });
  log('Session changed', picked);
  applyModeUI();
  fetchAndRenderNowPlaying(true).catch(e=>uiErr('Refresh after session change', e));
});
els.useBridge?.addEventListener('change', ()=>{ const cfg=getCfg(); setCfg({ ...cfg, forceBridge: !!els.useBridge.checked }); applyModeUI(); });

// ---------- Controls ----------
function applyModeUI(){
  const c = getCfg();
  const s = c?.sessionId ? sessionCache.get(c.sessionId) : null;
  const bridge = shouldUseBridge();
  const sup = new Set((s && s.SupportedCommands) || []);
  const prev = els.btnPrev, next = els.btnNext;
  if (prev) prev.disabled = (!bridge && sup.size && !sup.has('PreviousTrack'));
  if (next) next.disabled = (!bridge && sup.size && !sup.has('NextTrack'));
}

async function sendCmd(cmd){
  const c = getCfg();
  if (!c?.sessionId) throw new Error('Pick a session first.');
  if (shouldUseBridge()){
    const map = { Prev:'/prev', Next:'/next', Toggle:'/toggle' };
    const path = map[cmd]; if (!path) throw new Error(`Unsupported in bridge mode: ${cmd}`);
    await bridgePost(path);
  } else {
    if (cmd === 'Toggle'){
      const s = sessionCache.get(c.sessionId);
      const paused = s?.PlayState?.IsPaused;
      await jfPost(`/Sessions/${c.sessionId}/Playing/${paused ? 'Unpause' : 'Pause'}`);
    } else if (cmd === 'Prev' || cmd === 'Next'){
      await jfPost(`/Sessions/${c.sessionId}/Playing/${cmd === 'Prev' ? 'PreviousTrack' : 'NextTrack'}`);
    }
  }
}

window.__lastVol = 100;
async function adjustVolume(delta){
  const c = getCfg();
  if (!c?.sessionId) throw new Error('Pick a session first.');
  if (shouldUseBridge()){
    await bridgePost(delta>0 ? '/volup' : '/voldown');
  } else {
    const s = sessionCache.get(c.sessionId);
    const base = (typeof s?.VolumeLevel === 'number') ? s.VolumeLevel : (window.__lastVol ?? 100);
    const newVol = Math.max(0, Math.min(100, base + delta));
    await jfPost(`/Sessions/${c.sessionId}/Command`, { Name:'SetVolume', Arguments:{ Volume:String(newVol) }});
    window.__lastVol = newVol;
  }
}

els.btnPrev?.addEventListener('click', async ()=>{ try{ await sendCmd('Prev'); uiInfo('<span class="ok">Previous</span>'); }catch(e){ uiErr('Previous', e);} });
els.btnToggle?.addEventListener('click', async ()=>{ try{ await sendCmd('Toggle'); uiInfo('<span class="ok">Toggle</span>'); }catch(e){ uiErr('Toggle', e);} });
els.btnNext?.addEventListener('click', async ()=>{ try{ await sendCmd('Next'); uiInfo('<span class="ok">Next</span>'); }catch(e){ uiErr('Next', e);} });
els.btnVolDown?.addEventListener('click', async ()=>{ try{ await adjustVolume(-5); uiInfo('<span class="ok">Vol−</span>'); }catch(e){ uiErr('Vol−', e);} });
els.btnVolUp?.addEventListener('click', async ()=>{ try{ await adjustVolume(+5); uiInfo('<span class="ok">Vol+</span>'); }catch(e){ uiErr('Vol+', e);} });

// ---------- Seek ----------
function updateSeekCss(){
  const r = els.seekRange; if (!r) return;
  const max = Number(r.max || 0), val = Number(r.value || 0);
  const pct = max ? (val/max*100) : 0;
  r.style.setProperty('--pct', pct + '%');
}
els.seekRange?.addEventListener('input', updateSeekCss);
els.seekRange?.addEventListener('change', ()=>{
  const val = parseInt(els.seekRange.value||'0',10);
  doSeek(val);
});
async function doSeek(secs){
  const c = getCfg(); if (!c.sessionId) return;
  try{
    if (shouldUseBridge()) await bridgePost(`/seek?ms=${secs*1000}`);
    else {
      const ticks = BigInt(secs) * 10_000_000n;
      await jfPost(`/Sessions/${c.sessionId}/Playing/Seek?positionTicks=${ticks.toString()}`);
    }
    uiInfo(`<span class="ok">Seek</span> to ${secs}s.`);
  }catch(e){ uiErr('Seek', e); }
}

// ---------- Fetch & render ----------
async function fetchAndRenderNowPlaying(forceArt=false){
  const c = getCfg();
  if (!c?.sessionId) { log('No session selected'); return; }

  const sessions = await jfGet(`/Sessions?t=${Date.now()}`);
  sessionCache = new Map(sessions.map(s => [s.Id, s]));
  const s = sessions.find(x => x.Id === c.sessionId);
  log('Render session', c.sessionId, !!s && !!s.NowPlayingItem ? 'has item' : 'no item');

  if (!s || !s.NowPlayingItem){
    els.npTitle.textContent = 'Idle';
    els.npSub.textContent = '';
    els.art?.removeAttribute('src');                        // ← FIXED broken line
    els.seekRange.max = 0; els.seekRange.value = 0; updateSeekCss();
    applyModeUI();
    return;
  }

  els.npTitle.textContent = s.NowPlayingItem.Name || 'Unknown';
  els.npSub.textContent = s.NowPlayingItem.Artists?.[0] || s.NowPlayingItem.Album || s.NowPlayingItem.SeriesName || '';

  const pos = Math.floor((s.PlayState?.PositionTicks || 0)/1e7);
  const dur = Math.floor((s.NowPlayingItem.RunTimeTicks || 0)/1e7);
  const fmt = x => `${Math.floor(x/60)}:${String(x%60).padStart(2,'0')}`;
  els.tCur.textContent = fmt(pos); els.tDur.textContent = fmt(dur);
  els.seekRange.max = dur || 0; els.seekRange.value = Math.min(pos, dur || 0); updateSeekCss();

  // icon
  if (s?.PlayState?.IsPaused) els.iconToggle.innerHTML = '<path d="M8 5v14l11-7z"/>';
  else els.iconToggle.innerHTML = '<path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/>';

  // art
  const itemId = s.NowPlayingItem.Id;
  const artId  = s.NowPlayingItem.AlbumId || itemId;
  if (artId && (forceArt || __lastItemId !== itemId)){
    const bust = Date.now();
    els.art.src = `${c.serverUrl}/Items/${artId}/Images/Primary?fillWidth=300&fillHeight=300&quality=80&_=${bust}`;
    els.art.alt = s.NowPlayingItem.Name || '';
    __lastItemId = itemId;
  }
  // hide broken icon if an image URL 404s
  els.art?.addEventListener('error', ()=>{
    els.art.removeAttribute('src');
    els.art.setAttribute('data-empty','1');
  });


  applyModeUI();
}

// ---------- Polling ----------
function startPolling(){
  if (pollTimer) clearInterval(pollTimer);
  // If WS is healthy, don't run a parallel poll loop
  if (wsHealthy) { log('Polling skipped (WS healthy)'); return; }
  const c0 = getCfg();
  const ms = parseInt(c0.pollMs || defaults.pollMs, 10);
  log('Start polling', ms, 'ms');
  const tick = ()=> fetchAndRenderNowPlaying(false).catch(e=>uiErr('Polling', e));
  tick(); // immediate
  pollTimer = setInterval(tick, ms);
}

els.pollMs?.addEventListener('change', ()=> { window.__saveSettings(); });

// ---------- Refresh button ----------
els.btnRefreshMeta?.addEventListener('click', async ()=>{
  try { await fetchAndRenderNowPlaying(true); uiInfo('<span class="ok">Refreshed</span>'); }
  catch(e){ uiErr('Refresh', e); }
});

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  log('Boot');
  try {
    // kick off websocket (no-op if ws.js isn’t loaded)
    window.JFWS?.connect?.();

    await loadSessions();
    startPolling();
  } catch(e) {
    uiErr('Boot', e);
  }
});

