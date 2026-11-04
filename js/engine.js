/* ============================================================
   engine.js
   引擎加载（多 CDN 回退）
   依赖：core.js（M3U8.setOverlay / M3U8.$）
   导出：M3U8.loadScript / M3U8.initEngine
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { $, setOverlay } = M3U8;

  const HLS_CDNS = [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js',
    'https://unpkg.com/hls.js@1.5.17/dist/hls.min.js',
    'https://cdn.jsdelivr.net/npm/hls.js@1.4.12/dist/hls.min.js',
    'https://registry.npmmirror.com/hls.js/1.5.17/files/dist/hls.min.js',
    'https://registry.npmmirror.com/hls.js/1.4.12/files/dist/hls.min.js'
  ];
  const engineDot = document.getElementById('engineDot');
  const engineName = document.getElementById('engineName');

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('加载失败: ' + src));
      document.head.appendChild(s);
    });
  }

  async function initEngine() {
    for (const src of HLS_CDNS) {
      try {
        await loadScript(src);
        if (window.Hls) {
          engineDot.className = 'dot ok';
          engineName.textContent = 'hls.js ' + (window.Hls.version || '');
          return true;
        }
      } catch (e) { /* 尝试下一个 */ }
    }
    // 原生 HLS 回退（Safari / iOS）
    const v = document.getElementById('video');
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      engineDot.className = 'dot ok';
      engineName.textContent = '原生 HLS（无并发统计）';
      window.__nativeHls = true;
      return true;
    }
    engineDot.className = 'dot err';
    engineName.textContent = '引擎不可用';
    setOverlay('引擎加载失败：无法获取 hls.js，且当前浏览器不支持原生 HLS。<br />请检查网络后刷新页面。', false);
    return false;
  }

  Object.assign(M3U8, { loadScript, initEngine });
})();
