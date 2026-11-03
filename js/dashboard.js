/* ============================================================
   dashboard.js
   数据面板刷新（下载速度曲线 + 实时指标）
   依赖：core.js（S / now / $ / fmtBytes / fmtSpeed）
   导出：M3U8.initSpark / M3U8.drawSpark / M3U8.tick
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { S, now, $, fmtBytes, fmtSpeed } = M3U8;

  function initSpark() {
    const c = $('spark');
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(54 * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.sparkCtx = ctx;
    S.sparkW = rect.width;
    S.sparkH = 54;
  }

  function drawSpark() {
    const ctx = S.sparkCtx;
    if (!ctx) return;
    const w = S.sparkW, h = S.sparkH;
    ctx.clearRect(0, 0, w, h);

    // 基线网格
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const y = (h / 3) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const data = S.spark;
    if (data.length < 2) return;
    const max = Math.max.apply(null, data.concat([1]));
    const n = 60;
    const step = w / (n - 1);
    const offset = n - data.length;

    const pts = data.map((v, i) => [ (offset + i) * step, h - 3 - (v / max) * (h - 10) ]);

    // 面积
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(34,211,238,.35)');
    grad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    pts.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(pts[pts.length - 1][0], h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  const video = $('video');

  function tick() {
    // 速度采样
    const t = now();
    const dt = (t - S.speed.ts) / 1000;
    if (dt > 0) {
      S.speed.current = Math.max(0, (S.net.bytes - S.speed.bytes) / dt);
      S.speed.bytes = S.net.bytes;
      S.speed.ts = t;
    }
    S.spark.push(S.speed.current);
    if (S.spark.length > 60) S.spark.shift();

    const n = S.net;
    $('mDownloaded').textContent = String(n.downloads);
    $('mBytes').textContent = fmtBytes(n.bytes);
    $('mSpeed').textContent = fmtSpeed(S.speed.current);
    $('mBw').textContent = n.bwEwma ? '均值 ' + fmtSpeed(n.bwEwma) : '—';
    $('mCache').textContent = fmtBytes(S.cacheBytes);
    $('mItems').textContent = S.cache.size + ' 条 / 上限 ' + S.cacheLimitMB + ' MB';
    $('mActive').textContent = S.active + ' / ' + S.concurrency;
    $('mQueue').textContent = '队列 ' + S.queue.length + ' · 峰值 ' + n.activePeak;
    $('mPrefetch').textContent = n.prefetched + ' / ' + n.errors;

    const reqs = n.playerReqs || 0;
    const rate = reqs ? Math.round((n.hits / reqs) * 100) : 0;
    $('mHit').textContent = rate + '%';
    $('mHitDetail').textContent = n.hits + ' / ' + reqs + ' 次请求';
    $('bHit').textContent = rate + '%';

    // 缓冲时长
    try {
      if (video.buffered.length) {
        const end = video.buffered.end(video.buffered.length - 1);
        const buf = Math.max(0, end - video.currentTime);
        $('bBuf').textContent = buf.toFixed(1) + 's';
      }
    } catch (e) {}

    drawSpark();
  }

  Object.assign(M3U8, { initSpark, drawSpark, tick });
})();
