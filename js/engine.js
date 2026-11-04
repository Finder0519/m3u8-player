/* ============================================================
   engine.js
   引擎加载（纯本地，从 js/hls.min.js 加载，不依赖 CDN）
   依赖：core.js（M3U8.setOverlay / M3U8.$）
   导出：M3U8.loadScript / M3U8.initEngine
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { $, setOverlay } = M3U8;

  const LOCAL_HLS = 'js/hls.min.js';  // 本地副本，全离线加载
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
    try {
      await loadScript(LOCAL_HLS);
      if (window.Hls) {
        engineDot.className = 'dot ok';
        engineName.textContent = 'hls.js ' + (window.Hls.version || '');
        return true;
      }
    } catch (e) {
      // 本地文件缺失：不依赖 CDN，直接走原生回退
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
    setOverlay('引擎加载失败：无法获取本地 hls.js（js/hls.min.js 缺失），且当前浏览器不支持原生 HLS。<br />请确认本地文件存在后刷新页面。', false);
    return false;
  }

  Object.assign(M3U8, { loadScript, initEngine });
})();
