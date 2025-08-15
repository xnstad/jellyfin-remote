(function () {
  let ws = null, keep = null, backoff = 1000;
  const log = (...a) => console.log('[JFWS]', ...a);

  function cfg() {
    try { return JSON.parse(localStorage.getItem('jf_remote_cfg') || '{}'); }
    catch { return {}; }
  }

  function buildWsUrl() {
    const c = cfg();
    if (!c.serverUrl || !c.token) return null;

    // Parse serverUrl to preserve scheme, host, port, and *base path*
    let u;
    try { u = new URL(c.serverUrl); } catch { return null; }

    // Choose ws/wss to match http/https
    const proto = (u.protocol === 'https:') ? 'wss:' : 'ws:';
    // Ensure url base path (might be "" or "/jellyfin") has no trailing slash
    const basePath = u.pathname.replace(/\/$/, '');
    // Final WS endpoint: <proto>//<host><base>/socket
    const endpoint = `${proto}//${u.host}${basePath}/socket`;

    const qs = new URLSearchParams({
      api_key: c.token,
      deviceId: c.deviceId || ('pwa-' + Math.random().toString(16).slice(2)),
      version: '1.0.0',
      client: c.clientName || 'JellyRemote PWA'
    });

    const full = `${endpoint}?${qs.toString()}`;
    log('WS URL', full);
    return full;
  }

  function connect() {
    const url = buildWsUrl();
    if (!url) { log('Skipped connect (bad serverUrl/token)'); return; }

    try { ws = new WebSocket(url); }
    catch (e) { log('WS ctor failed', e); return scheduleReconnect(); }

    ws.onopen = () => {
      log('open');
      backoff = 1000;
      window.dispatchEvent(new CustomEvent('jfws:open'));
      try { ws.send(JSON.stringify({ MessageType: 'SessionsStart' })); } catch {}
      keep = setInterval(() => { try { ws?.send(JSON.stringify({ MessageType: 'KeepAlive' })); } catch {} }, 30000);
    };

    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.MessageType === 'Sessions' && Array.isArray(m.Data)) {
        window.dispatchEvent(new CustomEvent('jfws:sessions', { detail: m.Data }));
      }
    };

    ws.onerror = (e) => log('error', e);
    ws.onclose = () => {
      log('close');
      if (keep) { clearInterval(keep); keep = null; }
      window.dispatchEvent(new CustomEvent('jfws:close'));
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    try { ws?.close(); } catch {}
    ws = null;
    const delay = backoff;
    backoff = Math.min(backoff * 2, 30000);
    setTimeout(connect, delay);
  }

  function stop() {
    if (keep) { clearInterval(keep); keep = null; }
    try { ws?.close(); } catch {}
    ws = null;
  }

  function isOpen() { return !!ws && ws.readyState === 1; }

  window.JFWS = { connect, stop, isOpen };
  document.addEventListener('DOMContentLoaded', connect);
})();
