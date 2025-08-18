/* === App state + elements === */
const els = {
  // settings
  serverUrl: document.getElementById('serverUrl'),
  token: document.getElementById('token'),
  deviceId: document.getElementById('deviceId'),
  clientName: document.getElementById('clientName'),
  bridgeUrl: document.getElementById('bridgeUrl'),
  bridgeSecret: document.getElementById('bridgeSecret'),
  pollMs: document.getElementById('pollMs'),
  status: document.getElementById('status'),

  // sessions (JF mode)
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
  btnPrev: document.getElementById('btnPrev'),
  btnToggle: document.getElementById('btnToggle'),
  btnNext: document.getElementById('btnNext'),
  btnVolDown: document.getElementById('btnVolDown'),
  btnVolUp: document.getElementById('btnVolUp'),
  iconToggle: document.getElementById('iconToggle'),

  // misc
  opStatus: document.getElementById('opStatus'),

  // tabs
  tabJf: document.getElementById('tabJf'),
  tabBridge: document.getElementById('tabBridge'),
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

const defaults = {
  clientName: 'JellyRemote PWA',
  pollMs: 1000,
  bridgeUrl: '',
  bridgeSecret: ''
};

function makeUUID(){
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8); return v.toString(16);
  });
}

function cfgGet(){
  const c = JSON.parse(localStorage.getItem('jf_remote_cfg') || '{}');
  if (!c.deviceId) { c.deviceId = makeUUID(); localStorage.setItem('jf_remote_cfg', JSON.stringify(c)); }
  return Object.assign({}, defaults, c);
}
function cfgSave(newCfg){
  localStorage.setItem('jf_remote_cfg', JSON.stringify(newCfg));
}
function fillSheetFromCfg(c){
  els.serverUrl.value = c.serverUrl || '';
  els.token.value = c.token || '';
  els.deviceId.value = c.deviceId;
  els.clientName.value = c.clientName || defaults.clientName;
  els.bridgeUrl.value = c.bridgeUrl || '';
  els.bridgeSecret.value = c.bridgeSecret || '';
  els.pollMs.value = c.pollMs || defaults.pollMs;
}

/* === Settings sheet helpers for inline HTML buttons === */
window.__openSettings = function(){
  const c = cfgGet();
  fillSheetFromCfg(c);
  document.getElementById('sheet')?.classList.add('open');
  if (location.hash !== '#sheet') history.replaceState(null,'','#sheet');
};
window.__closeSettings = function(){
  document.getElementById('sheet')?.classList.remove('open');
  if (location.hash) history.replaceState(null,'',' ');
};
window.__saveSettings = function(){
  const cur = cfgGet();
  const newCfg = {
    serverUrl: els.serverUrl.value.trim().replace(/\/$/, ''),
    token: els.token.value.trim(),
    deviceId: (els.deviceId.value || cur.deviceId).trim(),
    clientName: els.clientName.value.trim() || defaults.clientName,
    pollMs: parseInt(els.pollMs.value,10) || defaults.pollMs,
    sessionId: els.sessionSelect?.value || null,
    bridgeUrl: els.bridgeUrl.value.trim().replace(/\/$/, ''),
    bridgeSecret: els.bridgeSecret.value.trim(),
    forceBridge: !!els.useBridge?.checked
  };
  cfgSave(newCfg);
  els.status.textContent = 'Saved.'; setTimeout(()=> els.status.textContent='',1500);
};
window.__testConnection = async function(){
  try{
    const sys = await jfGet('/System/Info/Public');
    els.status.innerHTML = `Connected to <span class="ok">${sys.ServerName}</span> (v${sys.Version})`;
  }catch(e){
    els.status.innerHTML = `<span class="err">Connection failed:</span> ${e.message}`;
  }
};

/* === Mode / tabs === */
const MODE_KEY='jf_remote_mode';
function getMode(){ return (localStorage.getItem(MODE_KEY)==='bridge') ? 'bridge' : 'jf'; }
function setMode(m){
  const mode=(m==='bridge')?'bridge':'jf';
  localStorage.setItem(MODE_KEY, mode);
  document.body.classList.toggle('mode-bridge', mode==='bridge');
  document.body.classList.toggle('mode-jf', mode==='jf');
  els.tabJf?.setAttribute('aria-selected', String(mode==='jf'));
  els.tabBridge?.setAttribute('aria-selected', String(mode==='bridge'));
}
function stopAllPolling(){ if (window.__jfTimer) clearInterval(window.__jfTimer); if (window.__bridgeTimer) clearInterval(window.__bridgeTimer); window.__jfTimer=null; window.__bridgeTimer=null; }

els.tabJf?.addEventListener('click', async ()=>{
  stopAllPolling(); setMode('jf'); await loadSessions(); startJellyfinPolling();
});
els.tabBridge?.addEventListener('click', ()=>{
  stopAllPolling(); setMode('bridge'); startBridgePolling();
});

// initial mode
setMode(getMode());

/* === Jellyfin helpers === */
function authHeader(c){
  const auth = `MediaBrowser Client="${c.clientName||'JellyRemote PWA'}", Device="PWA", DeviceId="${c.deviceId}", Version="1.0.0", Token="${c.token}"`;
  return { 'Authorization': auth, 'X-Emby-Authorization': auth };
}
async function jfGet(path){
  const c = cfgGet();
  const r = await fetch(`${c.serverUrl}${path}`, { headers: authHeader(c), cache:'no-store' });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}
async function jfPost(path, body){
  const c = cfgGet();
  const r = await fetch(`${c.serverUrl}${path}`, { method:'POST', headers:{ ...authHeader(c), 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : null });
  if (!r.ok && r.status !== 204) throw new Error(`${r.status}: ${await r.text()}`);
  return r;
}

/* === Bridge helpers === */
async function bridgePost(path){
  const c = cfgGet();
  if (!c.bridgeUrl) throw new Error('Bridge URL not set');
  const r = await fetch(c.bridgeUrl + path, { method:'POST', headers:{ 'X-Secret': c.bridgeSecret || '' } });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r;
}
async function bridgeFetchNowPlaying(){
  const c = cfgGet();
  const r = await fetch(`${c.bridgeUrl}/nowplaying`, { headers:{ 'X-Secret': c.bridgeSecret || '' }, cache:'no-store' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

let __artObjectUrl = null;
let __bridgeTrackKey = null;

function clearArt(){
  if (__artObjectUrl) { URL.revokeObjectURL(__artObjectUrl); __artObjectUrl = null; }
  els.art.removeAttribute('src');
  els.art.setAttribute('data-empty','1');
}

async function bridgeLoadArtBlob(){
  const c = cfgGet();
  const r = await fetch(`${c.bridgeUrl}/art?ts=${Date.now()}`, {
    headers: { 'X-Secret': c.bridgeSecret || '' },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  const blob = await r.blob();
  if (__artObjectUrl) URL.revokeObjectURL(__artObjectUrl);
  __artObjectUrl = URL.createObjectURL(blob);
  els.art.src = __artObjectUrl;
  els.art.removeAttribute('data-empty');
}

window.addEventListener('beforeunload', () => {
  if (__artObjectUrl) URL.revokeObjectURL(__artObjectUrl);
});


/* === Sessions (JF mode) === */
let sessionCache = new Map();
async function loadSessions(){
  const c = cfgGet();
  els.sessionSelect.innerHTML = '<option>Loading…</option>';
  try{
    const sessions = await jfGet(`/Sessions?t=${Date.now()}`);
    sessionCache = new Map(sessions.map(s => [s.Id, s]));
    sessions.sort((a,b)=>(b.NowPlayingItem?1:0)-(a.NowPlayingItem?1:0));
    els.sessionSelect.innerHTML='';
    if (!sessions.length){
      const o=document.createElement('option'); o.textContent='No sessions visible'; els.sessionSelect.appendChild(o);
      cfgSave({ ...c, sessionId:null });
      applyModeUI(); return;
    }
    for (const s of sessions){
      const o=document.createElement('option');
      const label=`${s.DeviceName || s.Client || 'Unknown'} — ${s.UserName || 'User'}${s.NowPlayingItem ? ' • ▶ '+(s.NowPlayingItem.Name||''):''}`;
      o.value=s.Id; o.textContent=label; els.sessionSelect.appendChild(o);
    }
    let picked = c.sessionId && sessions.find(x=>x.Id===c.sessionId)?.Id;
    if (!picked) picked = (sessions.find(x=>x.NowPlayingItem)?.Id) || sessions[0].Id;
    els.sessionSelect.value = picked;
    cfgSave({ ...c, sessionId:picked });
    applyModeUI();
  }catch(e){
    els.sessionSelect.innerHTML=''; const o=document.createElement('option'); o.textContent=`Error: ${e.message}`; els.sessionSelect.appendChild(o);
  }
}
document.getElementById('refreshSessions')?.addEventListener('click', loadSessions);
document.getElementById('sessionSelect')?.addEventListener('change', ()=>{ const c=cfgGet(); cfgSave({ ...c, sessionId: els.sessionSelect.value }); applyModeUI(); startJellyfinPolling(); });
document.getElementById('useBridge')?.addEventListener('change', ()=>{ const c=cfgGet(); cfgSave({ ...c, forceBridge: !!els.useBridge.checked }); applyModeUI(); });

/* === Controls (mode-aware) === */
function applyModeUI(){
  const mode = getMode();
  if (mode==='bridge'){
    els.btnPrev?.removeAttribute('disabled'); els.btnNext?.removeAttribute('disabled'); return;
  }
  const c = cfgGet(); const s = c?.sessionId ? sessionCache.get(c.sessionId) : null;
  const sup = new Set((s && s.SupportedCommands) || []);
  if (els.btnPrev) els.btnPrev.disabled = (sup.size && !sup.has('PreviousTrack'));
  if (els.btnNext) els.btnNext.disabled = (sup.size && !sup.has('NextTrack'));
}
async function sendCmd(kind){
  const mode=getMode();
  if (mode==='bridge'){
    const map={ Prev:'/prev', Next:'/next', Toggle:'/toggle' };
    const p = map[kind]; if (!p) throw new Error(`Unsupported in bridge: ${kind}`);
    await bridgePost(p);
    return;
  }
  const c=cfgGet(); if (!c.sessionId) throw new Error('Pick a session first.');
  if (kind==='Toggle'){
    const s=sessionCache.get(c.sessionId); const paused=!!s?.PlayState?.IsPaused;
    await jfPost(`/Sessions/${c.sessionId}/Playing/${paused?'Unpause':'Pause'}`);
  } else if (kind==='Prev' || kind==='Next'){
    await jfPost(`/Sessions/${c.sessionId}/Playing/${kind==='Prev'?'PreviousTrack':'NextTrack'}`);
  }
}
window.__lastVol=100;
async function adjustVolume(delta){
  const mode=getMode();
  if (mode==='bridge'){ await bridgePost(delta>0?'/volup':'/voldown'); return; }
  const c=cfgGet(); if (!c.sessionId) throw new Error('Pick a session first.');
  const s = sessionCache.get(c.sessionId);
  const base = (typeof s?.VolumeLevel === 'number') ? s.VolumeLevel : (window.__lastVol ?? 100);
  const newVol = Math.max(0, Math.min(100, base + delta));
  await jfPost(`/Sessions/${c.sessionId}/Command`, { Name:'SetVolume', Arguments:{ Volume:String(newVol) }});
  window.__lastVol = newVol;
}

/* === Seek bar paint === */
function updateSeekCss(){
  const r = els.seekRange; const max=Number(r.max||0), val=Number(r.value||0);
  const pct = max ? (val/max*100) : 0; r.style.setProperty('--pct', pct+'%');
}
els.seekRange.addEventListener('input', updateSeekCss);
els.seekRange.addEventListener('change', ()=> doSeek(parseInt(els.seekRange.value||'0',10)));
async function doSeek(secs){
  const mode=getMode();
  if (mode==='bridge'){ await bridgePost(`/seek?ms=${secs*1000}`); els.opStatus.innerHTML='<span class="ok">Seek</span>'; return; }
  const c=cfgGet(); if (!c.sessionId) return;
  const ticks = BigInt(secs) * 10_000_000n;
  await jfPost(`/Sessions/${c.sessionId}/Playing/Seek?positionTicks=${ticks}`);
  els.opStatus.innerHTML='<span class="ok">Seek</span>';
}

/* === Pollers === */
function fmtTime(x){ return `${Math.floor(x/60)}:${String(x%60).padStart(2,'0')}`; }

function startJellyfinPolling(){
  if (window.__jfTimer) clearInterval(window.__jfTimer);
  const ms = parseInt(cfgGet().pollMs || defaults.pollMs, 10);
  const tick = async (forceArt=false)=>{
    try{
      const c=cfgGet(); if (!c.sessionId) return;
      const sessions = await jfGet(`/Sessions?t=${Date.now()}`);
      sessionCache = new Map(sessions.map(s => [s.Id, s]));
      const s = sessions.find(x=>x.Id===c.sessionId);

      if (!s || !s.NowPlayingItem){
        els.npTitle.textContent='Idle'; els.npSub.textContent='';
        els.art.removeAttribute('src'); els.art.setAttribute('data-empty','1');
        els.seekRange.max = 0; els.seekRange.value = 0; updateSeekCss(); applyModeUI(); return;
      }

      const paused = !!s?.PlayState?.IsPaused;
      els.iconToggle.innerHTML = paused ? '<path d="M8 5v14l11-7z"/>' : '<path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/>';

      els.npTitle.textContent = s.NowPlayingItem.Name || 'Unknown';
      els.npSub.textContent = s.NowPlayingItem.Artists?.[0] || s.NowPlayingItem.Album || s.NowPlayingItem.SeriesName || '';

      const itemId=s.NowPlayingItem.Id; const artId=s.NowPlayingItem.AlbumId || itemId;
      if (artId && (forceArt || window.__lastItemId !== itemId)){
        els.art.src=`${c.serverUrl}/Items/${artId}/Images/Primary?fillWidth=300&fillHeight=300&quality=80&_=${Date.now()}`;
        els.art.alt=s.NowPlayingItem.Name||''; els.art.removeAttribute('data-empty'); window.__lastItemId=itemId;
      }

      const pos=Math.floor((s.PlayState?.PositionTicks||0)/1e7);
      const dur=Math.floor((s.NowPlayingItem.RunTimeTicks||0)/1e7);
      els.tCur.textContent=fmtTime(pos); els.tDur.textContent=fmtTime(dur);
      els.seekRange.max = dur||0; els.seekRange.value = Math.min(pos, dur||0); updateSeekCss(); applyModeUI();
    }catch(e){
      els.opStatus.innerHTML=`<span class="err">JF poll:</span> ${e.message}`;
    }
  };
  tick(true);
  window.__jfTimer = setInterval(()=>tick(false), ms);
}

function startBridgePolling(){
  if (window.__bridgeTimer) clearInterval(window.__bridgeTimer);
  const ms = parseInt(cfgGet().pollMs || defaults.pollMs, 10);

  const tick = async (forceArt=false)=>{
    try{
      const np = await bridgeFetchNowPlaying();

      if (!np?.hasSession){
        els.npTitle.textContent = 'No session on phone';
        els.npSub.textContent = '';
        clearArt();
        els.seekRange.max = 0; els.seekRange.value = 0; updateSeekCss();
        applyModeUI();
        __bridgeTrackKey = null; // reset
        return;
      }

      // toggle icon
      els.iconToggle.innerHTML = np.isPlaying
        ? '<path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/>'
        : '<path d="M8 5v14l11-7z"/>';

      // metadata
      els.npTitle.textContent = np.title || np.clientLabel || 'Unknown';
      els.npSub.textContent   = [np.artist, np.album].filter(Boolean).join(' — ');

      // timing
      const pos = Math.floor((np.positionMs||0)/1000);
      const dur = Math.floor((np.durationMs||0)/1000);
      els.tCur.textContent = fmtTime(pos);
      els.tDur.textContent = fmtTime(dur);
      els.seekRange.max = dur || 0;
      els.seekRange.value = Math.min(pos, dur || 0);
      updateSeekCss();

      // art: reload when track changes (title/artist/album/package) or when forced
      const key = `${np.title||''}|${np.artist||''}|${np.album||''}|${np.clientPackage||''}`;
      if (forceArt || key !== __bridgeTrackKey) {
        await bridgeLoadArtBlob();
        __bridgeTrackKey = key;
      }

      applyModeUI();
    }catch(e){
      els.opStatus.innerHTML = `<span class="err">Bridge poll:</span> ${e.message}`;
    }
  };

  tick(true);
  window.__bridgeTimer = setInterval(()=>tick(false), ms);
}

/* === Control bindings === */
els.btnPrev.addEventListener('click', async()=>{ try{ await sendCmd('Prev'); els.opStatus.innerHTML='<span class="ok">Previous</span>'; }catch(e){ els.opStatus.innerHTML=`<span class="err">${e.message}</span>`; }});
els.btnToggle.addEventListener('click', async()=>{ try{ await sendCmd('Toggle'); els.opStatus.innerHTML='<span class="ok">Toggle</span>'; }catch(e){ els.opStatus.innerHTML=`<span class="err">${e.message}</span>`; }});
els.btnNext.addEventListener('click', async()=>{ try{ await sendCmd('Next'); els.opStatus.innerHTML='<span class="ok">Next</span>'; }catch(e){ els.opStatus.innerHTML=`<span class="err">${e.message}</span>`; }});
els.btnVolDown.addEventListener('click', async()=>{ try{ await adjustVolume(-5); els.opStatus.innerHTML='<span class="ok">Vol−</span>'; }catch(e){ els.opStatus.innerHTML=`<span class="err">${e.message}</span>`; }});
els.btnVolUp.addEventListener('click', async()=>{ try{ await adjustVolume(+5); els.opStatus.innerHTML='<span class="ok">Vol+</span>'; }catch(e){ els.opStatus.innerHTML=`<span class="err">${e.message}</span>`; }});

/* === Start up according to mode === */
(async function boot(){
  const mode=getMode();
  if (mode==='jf'){ await loadSessions(); startJellyfinPolling(); }
  else { startBridgePolling(); }
})();
