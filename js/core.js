/* ============================================================
   core.js
   全局命名空间 + 全局状态 S + 基础工具 + 网络诊断工具
   依赖：无（最先加载，创建 window.M3U8）
   导出：M3U8.$
         M3U8.now
         M3U8.ABORT
         M3U8.S
         M3U8.DEBUG / M3U8.DBG / M3U8.dbg
         M3U8.fmtBytes / M3U8.fmtSpeed
         M3U8.log
         M3U8.setOverlay / M3U8.hideOverlay
         M3U8.httpError / M3U8.netErrorPayload / M3U8.hintFor / M3U8.probeReachability
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8 = window.M3U8 || {};

  const $ = (id) => document.getElementById(id);
  const now = () => performance.now();
  const ABORT = Symbol('abort');

  /* ============================================================
     全局状态
     ============================================================ */
  const S = {
    hls: null,
    concurrency: 6,
    prefetchAhead: 4,
    cacheLimitMB: 200,
    prefetchEnabled: true,

    queue: [],          // 待下载任务
    running: new Map(), // key -> task
    inflight: new Map(),// key -> promise（去重）
    cache: new Map(),   // key -> { data, size }
    cacheBytes: 0,
    active: 0,

    net: {
      downloads: 0, bytes: 0, errors: 0, prefetched: 0,
      playerReqs: 0, hits: 0, activePeak: 0, bwEwma: 0
    },
    speed: { bytes: 0, ts: performance.now(), current: 0 },
    spark: [],
    playing: false,
    currentUrl: '',
    manifestRetry: 0,
    netRetry: 0,
    retryTimer: null
  };

  /* 调试探针：地址加 ?debug=1 后可用 window.__dbg() 查看 */
  const DEBUG = /[?&]debug=1/.test(location.search);
  const DBG = [];
  function dbg(...args) {
    if (!DEBUG) return;
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    DBG.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (DBG.length > 400) DBG.shift();
    console.log('[m3u8] ' + line);
  }
  window.__dbg = () => DBG.slice();

  /* ============================================================
     基础工具
     ============================================================ */
  function fmtBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function fmtSpeed(bps) { return fmtBytes(bps) + '/s'; }

  function log(msg, kind = 'info') {
    const box = $('log');
    const line = document.createElement('div');
    line.className = 'log-line ' + kind;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const m = document.createElement('span');
    m.className = 'm';
    m.textContent = msg;
    line.append(t, m);
    box.prepend(line);
    while (box.children.length > 120) box.lastChild.remove();
  }

  function setOverlay(html, spinning) {
    $('overlayMsg').innerHTML = html;
    $('spinner').classList.toggle('on', !!spinning);
    $('overlay').classList.remove('hide');
  }
  function hideOverlay() { $('overlay').classList.add('hide'); $('spinner').classList.remove('on'); }

  /* ============================================================
     网络诊断工具
     ============================================================ */
  function httpError(res) {
    const err = new Error('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : ''));
    err.status = res.status;
    return err;
  }

  /** 把 fetch 异常整理成 hls.js 的 { code, text }：code 必须是真实 HTTP 状态，
   *  否则 hls.js 会把自定义码渲染成 "A network error (status 1)" 这类误导性文案 */
  function netErrorPayload(err) {
    const status = err && err.status ? err.status : 0;
    const raw = (err && err.message) || String(err || '网络错误');
    return { code: status, text: raw };
  }

  /** 根据失败原因给出可操作的建议 */
  function hintFor(reason, diag) {
    if (/\b(401|403)\b/.test(reason)) return '链接可能已过期或需要鉴权、防盗链：请重新复制最新的播放地址再试。';
    if (/\b404\b/.test(reason)) return '地址不存在：确认频道是否已下线、路径是否完整。';
    if (/Failed to fetch|NetworkError|Load failed|拦截|跨域/i.test(reason)) {
      if (diag === 'cors') return '服务器可以访问，但没有返回 Access-Control-Allow-Origin，被浏览器的跨域策略拦下了。另需确认该地址不是限时授权链接（令牌过期常表现为同样的报错）。';
      if (diag === 'unreachable') return '请求没有到达服务器：请检查网络、DNS 或该域名是否可访问（也可能被代理 / 防火墙拦截）。';
      return '浏览器未能拿到响应。常见原因：① 服务器未返回 Access-Control-Allow-Origin；② 限时授权链接的令牌已过期；③ DNS / 证书 / 网络中断。';
    }
    if (/timeout/i.test(reason)) return '请求超时：服务器响应过慢，可稍后重试或换用更近的节点。';
    return '请检查网络连通性与地址是否有效。';
  }

  /** 用 no-cors 探测一次：能发出（opaque）说明服务器可达，失败说明网络层就不通 */
  function probeReachability(url) {
    return new Promise((resolve) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => { ctrl.abort(); resolve('timeout'); }, 5000);
      fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
        .then(() => { clearTimeout(t); resolve('cors'); })
        .catch(() => { clearTimeout(t); resolve('unreachable'); });
    });
  }

  Object.assign(M3U8, {
    $, now, ABORT, S, DEBUG, DBG, dbg,
    fmtBytes, fmtSpeed,
    log, setOverlay, hideOverlay,
    httpError, netErrorPayload, hintFor, probeReachability
  });
})();
