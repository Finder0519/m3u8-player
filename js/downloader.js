/* ============================================================
   downloader.js
   并发下载调度 + 切片预取 + 自定义 hls.js Loader（网络层主体）
   依赖：core.js（S / now / dbg / ABORT / httpError / netErrorPayload）
         cache.js（cacheKey / normRange / getCached / putCache）
   导出：M3U8.pump / M3U8.enqueue / M3U8.recordBandwidth / M3U8.runTask
         M3U8.requestSegment / M3U8.schedulePrefetch / M3U8.createStats
         M3U8.fillStats / M3U8.resetStats / M3U8.PrefetchLoader
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { S, now, dbg, ABORT, httpError, netErrorPayload, cacheKey, normRange, getCached, putCache } = M3U8;

  /* ============================================================
     并发下载调度器
     ============================================================ */
  function pump() {
    while (S.active < S.concurrency && S.queue.length > 0) {
      runTask(S.queue.shift());
    }
  }

  function enqueue(task) {
    // priority: 0 = 播放器请求（插队），2 = 预取（排队尾）
    if (task.priority === 0) {
      const i = S.queue.findIndex((t) => t.priority > 0);
      if (i === -1) S.queue.push(task);
      else S.queue.splice(i, 0, task);
    } else {
      S.queue.push(task);
    }
  }

  function recordBandwidth(bytes, ms) {
    if (!bytes || ms <= 0) return;
    const bps = (bytes * 8 * 1000) / ms;
    S.net.bwEwma = S.net.bwEwma ? S.net.bwEwma * 0.7 + bps * 0.3 : bps;
  }

  async function runTask(task) {
    S.active++;
    S.net.activePeak = Math.max(S.net.activePeak, S.active);
    S.running.set(task.key, task);
    const t0 = now();
    let tFirst = t0;
    dbg('task:start', task.origin, task.url, task.rangeStart, task.rangeEnd);

    try {
      const headers = Object.assign({}, task.headers || {});
      const hasRange = task.rangeEnd !== null && task.rangeEnd !== undefined && task.rangeEnd > 0;
      if (hasRange) headers.Range = 'bytes=' + task.rangeStart + '-' + (task.rangeEnd - 1);

      const res = await fetch(task.url, {
        signal: task.ctrl.signal,
        headers,
        mode: 'cors',
        credentials: 'omit',
        cache: 'default'
      });
      tFirst = now();
      dbg('task:response', task.url, res.status, res.type);
      if (!res.ok && res.status !== 206) throw httpError(res);
      let buf = await res.arrayBuffer();

      // 服务端不支持 Range 时返回 200 全量，这里按范围裁剪
      if (hasRange && res.status === 200 && buf.byteLength >= task.rangeEnd) {
        buf = buf.slice(task.rangeStart, task.rangeEnd);
      }

      const t1 = now();
      recordBandwidth(buf.byteLength, t1 - tFirst);
      S.net.downloads++;
      S.net.bytes += buf.byteLength;
      if (task.origin === 'prefetch') S.net.prefetched++;
      putCache(task.key, buf);
      dbg('task:done', task.url, buf.byteLength, Math.round(t1 - t0) + 'ms');
      task.resolve({ data: buf, fromCache: false, t0, tFirst, t1, bytes: buf.byteLength });
    } catch (err) {
      dbg('task:error', task.url, (err && err.message) || String(err));
      if (err && err.name === 'AbortError') {
        task.reject(ABORT);
      } else {
        S.net.errors++;
        task.reject(err);
      }
    } finally {
      S.running.delete(task.key);
      S.inflight.delete(task.key);
      S.active--;
      pump();
    }
  }

  /**
   * 请求一个切片。命中内存缓存立即返回；同一 URL 在途请求自动合并。
   * @returns {{promise: Promise, fromCache: boolean, deduped: boolean}}
   */
  function requestSegment({ url, rangeStart, rangeEnd, priority = 2, origin = 'prefetch', headers = null }) {
    const key = cacheKey(url, rangeStart, rangeEnd);

    const cached = getCached(key);
    if (cached) {
      return { promise: Promise.resolve({ data: cached, fromCache: true, t0: now(), tFirst: now(), t1: now(), bytes: cached.byteLength }), fromCache: true, deduped: false };
    }

    const pending = S.inflight.get(key);
    if (pending) {
      return { promise: pending, fromCache: false, deduped: true };
    }

    let resolve, reject;
    const promise = new Promise((rs, rj) => { resolve = rs; reject = rj; });
    const task = {
      key, url, rangeStart, rangeEnd, priority, origin, headers,
      ctrl: new AbortController(), resolve, reject
    };
    S.inflight.set(key, promise);
    enqueue(task);
    pump();
    return { promise, fromCache: false, deduped: false };
  }

  /* ============================================================
     预取：把当前片段之后的 N 个切片提前下好
     ============================================================ */
  function schedulePrefetch(frag) {
    if (!S.prefetchEnabled || S.prefetchAhead <= 0) return;
    const hls = S.hls;
    if (!hls || !frag || frag.part) return;
    if (S.queue.length > 40) return;

    let list = null, idx = -1, levelIdx = -1;
    const levels = hls.levels || [];
    for (let li = 0; li < levels.length; li++) {
      const d = levels[li].details;
      if (d && d.fragments && d.fragments.length) {
        const i = d.fragments.indexOf(frag);
        if (i !== -1) { list = d.fragments; idx = i; levelIdx = li; break; }
      }
    }
    if (!list || idx < 0) return;
    // 只预取当前生效的档位，避免切换码率时白白下载另一个档位的切片
    if (hls.loadLevel !== levelIdx && hls.currentLevel !== levelIdx) return;

    for (let k = 1; k <= S.prefetchAhead; k++) {
      const f = list[idx + k];
      if (!f || !f.url || f.part) break;
      const rg = normRange(f.byteRangeStartOffset, f.byteRangeEndOffset);
      const key = cacheKey(f.url, rg.start, rg.end);
      if (S.cache.has(key) || S.inflight.has(key)) continue;
      requestSegment({
        url: f.url,
        rangeStart: rg.start,
        rangeEnd: rg.end,
        priority: 2,
        origin: 'prefetch'
      }).promise.catch(() => {});
    }
  }

  /* ============================================================
     自定义 Loader：接管 hls.js 的网络层
     ============================================================ */
  function createStats() {
    const t = now();
    return {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      trequest: t, tfirst: 0, tload: 0,
      loading: { start: t, first: 0, end: 0, total: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, end: 0, first: 0, total: 0 }
    };
  }

  /** 用真实（或折算）下载时序填充 hls.js 的 stats，保证 ABR 估算合理 */
  function fillStats(stats, meta) {
    const len = meta.data ? meta.data.byteLength : 0;
    stats.loaded = len;
    stats.total = Math.max(len, meta.bytes || 0);
    stats.chunkCount = 1;

    if (meta.fromCache) {
      // 命中缓存：按实测带宽折算一个等效耗时，避免 ABR 误判为无限带宽
      const bw = S.net.bwEwma || 4000000;
      const synth = Math.max(1, (len * 8 * 1000) / bw);
      stats.trequest = meta.t1 - synth;
      stats.tfirst = stats.trequest;
      stats.tload = meta.t1;
      stats.bwEstimate = bw;
    } else {
      stats.trequest = meta.t0;
      stats.tfirst = meta.tFirst || meta.t0;
      stats.tload = meta.t1;
      stats.bwEstimate = S.net.bwEwma;
    }
    stats.loading.start = stats.trequest;
    stats.loading.first = stats.tfirst;
    stats.loading.end = stats.tload;
  }

  /** 原地重置 stats：hls.js 会把 loader.stats 挂到 frag.stats，替换对象会读到旧值 */
  function resetStats(stats) {
    Object.assign(stats, createStats());
    return stats;
  }

  class PrefetchLoader {
    constructor(config) {
      this.config = config || {};
      // hls.js 会把 loader.stats 挂到 frag.stats 上，因此构造时就要有值
      this.stats = createStats();
      this.context = null;
      this.callbacks = null;
      this.ctrl = null;
      this.settled = true;
      this.destroyed = false;
    }

    destroy() {
      this.destroyed = true;
      this.abort();
    }

    /** hls.js 在切档 / 缓冲刷新 / 关闭时会调用；必须回调 onAbort 让内部状态复位 */
    abort() {
      if (this.settled) return;
      const stats = this.stats;
      const context = this.context;
      const callbacks = this.callbacks;
      this.settled = true;
      const ctrl = this.ctrl;
      this.ctrl = null;
      if (ctrl && this._abortOnDemand) ctrl.abort(); // 仅 LL-HLS part 需要真正取消请求
      if (callbacks && callbacks.onAbort) callbacks.onAbort(stats, context, null);
    }

    load(context, config, callbacks) {
      const type = context.type;
      dbg('load', type || 'frag?', context.url || (context.frag && context.frag.url), !!context.part);
      this.context = context;
      this.callbacks = callbacks;
      resetStats(this.stats);
      this.settled = false;
      this.ctrl = new AbortController();
      this._abortOnDemand = false;

      if (type === 'manifest' || type === 'level' || type === 'audioTrack' || type === 'subtitleTrack') {
        return this._loadPlaylist(context, config, callbacks);
      }
      if (context.frag) {
        return this._loadFragment(context, config, callbacks);
      }
      return this._loadBinary(context, config, callbacks);
    }

    _done() {
      this.settled = true;
      this.ctrl = null;
    }

    /* ---- 播放列表（m3u8 文本）：不做缓存，始终取最新 ---- */
    _loadPlaylist(context, config, callbacks) {
      const url = context.url;
      const stats = this.stats;
      const ctrl = this.ctrl;
      const timeout = (context.type === 'manifest' ? config.manifestLoadingTimeOut : config.levelLoadingTimeOut) || 20000;
      let timedOut = false;
      const timer = setTimeout(() => {
        if (this.settled) return;
        timedOut = true;
        this._done();
        stats.aborted = true;
        if (callbacks.onTimeout) callbacks.onTimeout(stats, context, null);
        ctrl.abort();
      }, Math.min(timeout, 45000));

      fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', headers: context.headers || {} })
        .then((res) => {
          if (!res.ok) throw httpError(res);
          stats.tfirst = now();
          return res.text();
        })
        .then((text) => {
          if (timedOut || this.settled) return;
          clearTimeout(timer);
          this._done();
          stats.tload = now();
          stats.loaded = text.length;
          stats.total = text.length;
          stats.chunkCount = 1;
          stats.loading.first = stats.tfirst;
          stats.loading.end = stats.tload;
          stats.bwEstimate = S.net.bwEwma;
          callbacks.onSuccess({ url, data: text }, stats, context, null);
        })
        .catch((err) => {
          clearTimeout(timer);
          if (timedOut) return;
          if (err && err.name === 'AbortError') {
            if (!this.settled) { this._done(); stats.aborted = true; if (callbacks.onAbort) callbacks.onAbort(stats, context, null); }
            return;
          }
          this._done();
          callbacks.onError(netErrorPayload(err), context, null, stats);
        });
    }

    /* ---- 普通二进制请求（如解密密钥） ---- */
    _loadBinary(context, config, callbacks) {
      const url = context.url;
      const stats = this.stats;
      const ctrl = this.ctrl;

      fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit', headers: context.headers || {} })
        .then((res) => {
          if (!res.ok) throw httpError(res);
          stats.tfirst = now();
          return res.arrayBuffer();
        })
        .then((buf) => {
          if (this.settled) return;
          this._done();
          stats.tload = now();
          stats.loaded = buf.byteLength;
          stats.total = buf.byteLength;
          stats.chunkCount = 1;
          stats.loading.first = stats.tfirst;
          stats.loading.end = stats.tload;
          stats.bwEstimate = S.net.bwEwma;
          callbacks.onSuccess({ url, data: buf }, stats, context, null);
        })
        .catch((err) => {
          if (err && err.name === 'AbortError') {
            if (!this.settled) { this._done(); stats.aborted = true; if (callbacks.onAbort) callbacks.onAbort(stats, context, null); }
            return;
          }
          this._done();
          callbacks.onError(netErrorPayload(err), context, null, stats);
        });
    }

    /* ---- 视频切片：走并发调度 + 预取缓存 ---- */
    _loadFragment(context, config, callbacks) {
      const frag = context.frag;
      const url = context.url || (frag && frag.url);
      const range = normRange(context.rangeStart, context.rangeEnd);
      const rangeStart = range.start;
      const rangeEnd = range.end;
      const headers = context.headers || null;
      const isPart = !!context.part; // LL-HLS 部分片段不缓存

      const stats = this.stats;
      const ctrl = this.ctrl;
      S.net.playerReqs++;

      const timer = setTimeout(() => {
        if (this.settled) return;
        this._done();
        stats.aborted = true;
        if (callbacks.onTimeout) callbacks.onTimeout(stats, context, null);
      }, Math.min(Math.max(config.fragLoadingTimeOut || 30000, 15000), 60000));

      const finish = () => {
        clearTimeout(timer);
        this._done();
      };

      // 1) 同步命中缓存（必须交出副本：hls.js 的 worker 会 transfer 并 detach 原 buffer）
      if (!isPart) {
        const cached = getCached(cacheKey(url, rangeStart, rangeEnd));
        if (cached) {
          S.net.hits++;
          const copy = cached.slice(0);
          if (frag) frag.__bytes = copy.byteLength;
          fillStats(stats, { data: copy, fromCache: true, t0: now(), tFirst: now(), t1: now(), bytes: copy.byteLength });
          Promise.resolve().then(() => {
            if (this.settled) return;
            finish();
            callbacks.onSuccess({ url, data: copy }, stats, context, null);
            schedulePrefetch(frag);
          });
          return;
        }
      }

      // 2) 交给并发调度器
      let req;
      if (isPart) {
        // LL-HLS part：不缓存、不去重，随 abort 一起取消
        this._abortOnDemand = true;
        let resolve, reject;
        const p = new Promise((rs, rj) => { resolve = rs; reject = rj; });
        const t0 = now();
        fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit', headers: headers || {} })
          .then((res) => {
            if (!res.ok) throw httpError(res);
            return res.arrayBuffer();
          })
          .then((buf) => resolve({ data: buf, fromCache: false, t0, tFirst: now(), t1: now(), bytes: buf.byteLength }))
          .catch(reject);
        req = { promise: p, fromCache: false, deduped: false };
      } else {
        req = requestSegment({ url, rangeStart, rangeEnd, priority: 0, origin: 'player', headers });
      }

      if (req.fromCache || req.deduped) S.net.hits++;

      req.promise
        .then((meta) => {
          if (this.settled) { dbg('frag:late', url); return; }
          finish();
          fillStats(stats, meta);
          // 交给 hls.js 的 buffer 必须是独立副本，否则 worker transfer 会 detach 缓存里的原始数据
          const data = isPart ? meta.data : meta.data.slice(0);
          if (frag) frag.__bytes = data.byteLength;
          dbg('frag:ok', url, data && data.byteLength);
          callbacks.onSuccess({ url, data }, stats, context, null);
          schedulePrefetch(frag);
        })
        .catch((err) => {
          if (this.settled) { dbg('frag:late-err', url); return; }
          finish();
          if (err === ABORT || (err && err.name === 'AbortError')) {
            stats.aborted = true;
            dbg('frag:abort', url);
            if (callbacks.onAbort) callbacks.onAbort(stats, context, null);
            return;
          }
          dbg('frag:err', url, (err && err.message) || String(err));
          callbacks.onError(netErrorPayload(err), context, null, stats);
        });
    }
  }

  Object.assign(M3U8, {
    pump, enqueue, recordBandwidth, runTask, requestSegment,
    schedulePrefetch, createStats, fillStats, resetStats, PrefetchLoader
  });
})();
