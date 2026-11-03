/* ============================================================
   cache.js
   切片缓存（LRU + 容量上限）
   依赖：core.js（M3U8.S）
   导出：M3U8.cacheKey / M3U8.normRange / M3U8.getCached
         M3U8.putCache / M3U8.trimCache / M3U8.clearCache
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { S } = M3U8;

  function cacheKey(url, start, end) {
    return (start !== undefined && start !== null && end !== undefined && end !== null)
      ? url + '|' + start + '-' + end
      : url;
  }

  /** hls.js 的 LoaderContext 默认把 rangeStart/rangeEnd 置为 0，只有 rangeEnd>0 才是真正的分段请求 */
  function normRange(start, end) {
    if (typeof end === 'number' && isFinite(end) && end > 0) {
      return {
        start: typeof start === 'number' && isFinite(start) ? start : 0,
        end
      };
    }
    return { start: null, end: null };
  }

  function getCached(key) {
    const item = S.cache.get(key);
    if (!item) return null;
    S.cache.delete(key);
    S.cache.set(key, item); // 移到队尾（最近使用）
    return item.data;
  }

  function putCache(key, data) {
    if (S.cache.has(key)) return;
    if (data.byteLength > S.cacheLimitMB * 1024 * 1024) return; // 单块超过上限则不缓存
    S.cache.set(key, { data, size: data.byteLength });
    S.cacheBytes += data.byteLength;
    trimCache();
  }

  function trimCache() {
    const limit = S.cacheLimitMB * 1024 * 1024;
    if (S.cacheBytes <= limit) return;
    for (const key of Array.from(S.cache.keys())) {
      if (S.cacheBytes <= limit) break;
      if (S.inflight.has(key) || S.running.has(key)) continue;
      const item = S.cache.get(key);
      if (!item) continue;
      S.cache.delete(key);
      S.cacheBytes -= item.size;
    }
  }

  function clearCache() {
    S.cache.clear();
    S.cacheBytes = 0;
  }

  Object.assign(M3U8, {
    cacheKey, normRange, getCached, putCache, trimCache, clearCache
  });
})();
