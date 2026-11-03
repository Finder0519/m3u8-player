/* ============================================================
   app.js
   启动逻辑（最后加载）
   依赖：core.js / cache.js / downloader.js / engine.js / player.js
         / controls.js / settings.js / dashboard.js
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { $, initSpark, drawSpark, syncSlider, tick, initEngine, log } = M3U8;

  window.addEventListener('resize', () => { initSpark(); drawSpark(); });

  initSpark();
  syncSlider($('concRange'), $('concVal'));
  syncSlider($('aheadRange'), $('aheadVal'));
  syncSlider($('cacheRange'), $('cacheVal'), (v) => v + ' MB');
  setInterval(tick, 250);

  initEngine().then((ok) => {
    if (ok) log('hls.js 引擎就绪', 'ok');
    else log('引擎初始化失败', 'err');
  });
  log('控制台就绪，等待地址…');
})();
