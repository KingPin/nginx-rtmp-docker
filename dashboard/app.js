(function () {
  'use strict';

  const STAT_URL = './stat';
  const REFRESH_MS = 5000;
  const APPLICATION_NAME = 'live';
  const RTMP_PORT = 1935;

  const els = {
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    uptime: document.getElementById('uptime'),
    bwIn: document.getElementById('bw-in'),
    bwOut: document.getElementById('bw-out'),
    nginxVersion: document.getElementById('nginx-version'),
    rtmpVersion: document.getElementById('rtmp-version'),
    streams: document.getElementById('streams'),
    rowTemplate: document.getElementById('stream-row-template'),
  };

  let inFlight = null;
  const playerInstances = new Map();

  function formatRate(bps) {
    const n = Number(bps);
    if (!Number.isFinite(n) || n <= 0) return '0 bps';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' Gbps';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + ' Mbps';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' kbps';
    return n.toFixed(0) + ' bps';
  }

  function formatDuration(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '–';
    const totalSec = Math.floor(n / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function txt(node, selector) {
    if (!node) return '';
    const el = node.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }
  function num(node, selector) {
    const t = txt(node, selector);
    if (t === '') return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  function has(node, selector) {
    return node ? node.querySelector(selector) !== null : false;
  }

  function parseStat(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('failed to parse stat XML');
    }
    const root = doc.querySelector('rtmp');
    if (!root) throw new Error('missing <rtmp> root');

    const server = {
      nginxVersion: txt(root, ':scope > nginx_version'),
      rtmpVersion: txt(root, ':scope > nginx_rtmp_version'),
      uptime: num(root, ':scope > uptime'),
      bwIn: num(root, ':scope > bw_in'),
      bwOut: num(root, ':scope > bw_out'),
    };

    const liveApp = Array.from(root.querySelectorAll(':scope > server > application'))
      .find((a) => txt(a, ':scope > name') === APPLICATION_NAME);

    const streams = [];
    if (liveApp) {
      const live = liveApp.querySelector(':scope > live');
      if (live) {
        for (const s of live.querySelectorAll(':scope > stream')) {
          streams.push({
            name: txt(s, ':scope > name'),
            time: num(s, ':scope > time'),
            bwIn: num(s, ':scope > bw_in'),
            bwOut: num(s, ':scope > bw_out'),
            bwVideo: num(s, ':scope > bw_video'),
            bwAudio: num(s, ':scope > bw_audio'),
            nClients: num(s, ':scope > nclients'),
            width: num(s, ':scope > meta > video > width'),
            height: num(s, ':scope > meta > video > height'),
            fps: num(s, ':scope > meta > video > frame_rate'),
            videoCodec: txt(s, ':scope > meta > video > codec'),
            publishing: has(s, ':scope > publishing'),
            active: has(s, ':scope > active'),
          });
        }
      }
    }

    return { server, streams };
  }

  function rtmpIngestUrl(streamName) {
    const host = window.location.hostname || 'localhost';
    return `rtmp://${host}:${RTMP_PORT}/${APPLICATION_NAME}/${streamName}`;
  }

  function hlsPlaybackUrl(streamName) {
    const base = new URL('./hls/', window.location.href);
    return new URL(`${encodeURIComponent(streamName)}.m3u8`, base).toString();
  }

  function copyToClipboard(text, btn) {
    const restore = btn.textContent;
    const flash = (msg) => {
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = restore; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => flash('copied'),
        () => flash('blocked')
      );
    } else {
      flash('no clipboard');
    }
  }

  function attachPlayer(videoEl, streamName) {
    teardownPlayer(streamName);
    const src = `./hls/${encodeURIComponent(streamName)}.m3u8`;
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ lowLatencyMode: true });
      hls.loadSource(src);
      hls.attachMedia(videoEl);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
      playerInstances.set(streamName, { hls, videoEl });
    } else {
      videoEl.src = src;
      videoEl.play().catch(() => {});
      playerInstances.set(streamName, { hls: null, videoEl });
    }
  }

  function teardownPlayer(streamName) {
    const inst = playerInstances.get(streamName);
    if (!inst) return;
    if (inst.videoEl) {
      try { inst.videoEl.pause(); } catch (_) {}
      inst.videoEl.removeAttribute('src');
      try { inst.videoEl.load(); } catch (_) {}
    }
    if (inst.hls) {
      try { inst.hls.destroy(); } catch (_) {}
    }
    playerInstances.delete(streamName);
  }

  function summaryLine(stream) {
    const parts = [];
    if (stream.width && stream.height) parts.push(`${stream.width}×${stream.height}`);
    if (stream.fps) parts.push(`${Math.round(stream.fps)}fps`);
    if (stream.videoCodec) parts.push(stream.videoCodec);
    parts.push(formatRate(stream.bwIn));
    parts.push(`${stream.nClients} client${stream.nClients === 1 ? '' : 's'}`);
    parts.push(formatDuration(stream.time));
    parts.push(stream.publishing ? '● publishing' : 'idle');
    return parts.join(' · ');
  }

  function buildRow(stream) {
    const frag = els.rowTemplate.content.cloneNode(true);
    const article = frag.querySelector('.stream');
    article.dataset.name = stream.name;

    article.querySelector('.stream-name').textContent = `${APPLICATION_NAME}/${stream.name}`;
    article.querySelector('.stream-summary').textContent = summaryLine(stream);

    const rtmpUrl = rtmpIngestUrl(stream.name);
    const hlsUrl = hlsPlaybackUrl(stream.name);
    article.querySelector('.rtmp-url').textContent = rtmpUrl;
    article.querySelector('.hls-url').textContent = hlsUrl;

    const copyButtons = article.querySelectorAll('.copy');
    copyButtons[0].addEventListener('click', () => copyToClipboard(rtmpUrl, copyButtons[0]));
    copyButtons[1].addEventListener('click', () => copyToClipboard(hlsUrl, copyButtons[1]));

    const toggle = article.querySelector('.preview-toggle');
    const preview = article.querySelector('.preview');
    const videoEl = preview.querySelector('video');
    toggle.addEventListener('click', () => {
      if (preview.hasAttribute('hidden')) {
        preview.removeAttribute('hidden');
        toggle.textContent = 'Preview ▴';
        attachPlayer(videoEl, stream.name);
      } else {
        preview.setAttribute('hidden', '');
        toggle.textContent = 'Preview ▾';
        teardownPlayer(stream.name);
      }
    });

    return article;
  }

  function renderServer(server) {
    // nginx-rtmp emits server <uptime> in seconds and per-stream <time> in
    // milliseconds (see ngx_rtmp_stat_module.c). Normalize to ms here.
    els.uptime.textContent = formatDuration(server.uptime * 1000);
    els.bwIn.textContent = formatRate(server.bwIn);
    els.bwOut.textContent = formatRate(server.bwOut);
    els.nginxVersion.textContent = server.nginxVersion || '–';
    els.rtmpVersion.textContent = server.rtmpVersion || '–';
  }

  function renderEmpty() {
    for (const name of Array.from(playerInstances.keys())) teardownPlayer(name);
    const p = document.createElement('p');
    p.className = 'empty';
    const host = window.location.hostname || 'localhost';
    p.textContent = `No active streams. Publish to rtmp://${host}:${RTMP_PORT}/${APPLICATION_NAME}/<key>`;
    els.streams.replaceChildren(p);
  }

  function renderStreams(streams) {
    if (!streams.length) {
      renderEmpty();
      return;
    }

    const existing = new Map();
    for (const el of els.streams.querySelectorAll('.stream')) {
      existing.set(el.dataset.name, el);
    }

    const seen = new Set();
    const ordered = [];

    for (const s of streams) {
      seen.add(s.name);
      let row = existing.get(s.name);
      if (row) {
        row.querySelector('.stream-summary').textContent = summaryLine(s);
      } else {
        row = buildRow(s);
      }
      ordered.push(row);
    }

    for (const name of Array.from(playerInstances.keys())) {
      if (!seen.has(name)) teardownPlayer(name);
    }

    els.streams.replaceChildren(...ordered);
  }

  function setStatus(state, text) {
    els.statusDot.className = `status-dot ${state}`;
    els.statusText.textContent = text;
  }

  async function refresh() {
    if (inFlight) inFlight.abort();
    const ctrl = new AbortController();
    inFlight = ctrl;
    try {
      const res = await fetch(STAT_URL, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const { server, streams } = parseStat(xml);
      renderServer(server);
      renderStreams(streams);
      setStatus('ok', 'healthy');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      setStatus('err', 'stat unreachable');
    } finally {
      if (inFlight === ctrl) inFlight = null;
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
