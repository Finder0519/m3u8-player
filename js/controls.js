/* ============================================================
   controls.js
   UI 交互绑定（下载设置滑块、播放按钮、示例、画质切换、视频事件）
   依赖：core.js（S / $ / log / setOverlay / hideOverlay）
         cache.js（trimCache）
         downloader.js（pump）
         player.js（startPlayback / stopAll）
   导出：M3U8.syncSlider
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { S, $, log, setOverlay, hideOverlay, trimCache, pump, startPlayback, stopAll } = M3U8;

  const video = $('video');

  function syncSlider(input, out, fmt) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--p', pct + '%');
    out.textContent = fmt ? fmt(input.value) : input.value;
  }

  $('concRange').addEventListener('input', (e) => {
    S.concurrency = Number(e.target.value);
    syncSlider(e.target, $('concVal'));
    pump();
  });
  $('aheadRange').addEventListener('input', (e) => {
    S.prefetchAhead = Number(e.target.value);
    syncSlider(e.target, $('aheadVal'));
  });
  $('cacheRange').addEventListener('input', (e) => {
    S.cacheLimitMB = Number(e.target.value);
    syncSlider(e.target, $('cacheVal'), (v) => v + ' MB');
    trimCache();
  });
  $('prefetchToggle').addEventListener('click', (e) => {
    S.prefetchEnabled = !S.prefetchEnabled;
    e.target.classList.toggle('on', S.prefetchEnabled);
    log('预取缓存已' + (S.prefetchEnabled ? '开启' : '关闭'));
  });

  $('loadBtn').addEventListener('click', () => startPlayback($('urlInput').value));
  $('urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startPlayback($('urlInput').value);
  });
  $('stopBtn').addEventListener('click', () => { log('已停止'); stopAll(); });
  $('clearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

  Array.from(document.querySelectorAll('.chip')).forEach((chip) => {
    chip.addEventListener('click', () => {
      $('urlInput').value = chip.dataset.url;
      startPlayback(chip.dataset.url);
    });
  });

  $('quality').addEventListener('change', (e) => {
    if (!S.hls) return;
    const v = Number(e.target.value);
    S.hls.currentLevel = v; // -1 表示自动
    log(v === -1 ? '切换为自动码率' : '手动切换到档位 ' + v);
  });

  video.addEventListener('playing', () => {
    hideOverlay();
    S.playing = true;
    $('liveHint').textContent = '播放中';
  });
  video.addEventListener('waiting', () => {
    if (S.playing) setOverlay('缓冲中…', true);
  });
  video.addEventListener('error', () => {
    if (!S.hls) setOverlay('视频元素报错，可能是流本身不可播放。', false);
  });

  Object.assign(M3U8, { syncSlider });
})();
