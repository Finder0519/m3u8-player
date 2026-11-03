/* ============================================================
   player.js
   播放器控制
   依赖：core.js（S / now / $ / log / fmtBytes / setOverlay / hideOverlay / hintFor / probeReachability）
         cache.js（clearCache）
         downloader.js（PrefetchLoader）
   导出：M3U8.populateQuality / M3U8.updateLevelBadges
         M3U8.destroyPlayback / M3U8.stopAll / M3U8.startPlayback
         M3U8.retryManifest / M3U8.giveUp
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const {
    S, now, $, log, fmtBytes, setOverlay, hideOverlay,
    ABORT, hintFor, probeReachability, clearCache, PrefetchLoader
  } = M3U8;

  const video = $('video');

  function populateQuality() {
    const sel = $('quality');
    const hls = S.hls;
    sel.innerHTML = '';
    sel.add(new Option('自动', '-1'));
    if (!hls || !hls.levels) return;
    hls.levels.forEach((l, i) => {
      const res = l.height > 0 ? l.height + 'p' : '档位 ' + (i + 1);
      const rate = l.bitrate ? (l.bitrate / 1e6).toFixed(2) + ' Mbps' : '';
      sel.add(new Option(res + (rate ? ' · ' + rate : ''), String(i)));
    });
    sel.value = hls.autoLevelEnabled ? '-1' : String(hls.currentLevel);
  }

  function updateLevelBadges() {
    const hls = S.hls;
    if (!hls) return;
    const lv = hls.levels && hls.levels[hls.currentLevel];
    if (lv) {
      const hasRes = lv.width > 0 && lv.height > 0;
      $('bRes').textContent = hasRes ? (lv.height + 'p') : '-';
      $('bRate').textContent = lv.bitrate ? (lv.bitrate / 1e6).toFixed(2) + ' Mbps' : '-';
    } else {
      $('bRes').textContent = '-';
      $('bRate').textContent = '-';
    }
    $('quality').value = hls.autoLevelEnabled ? '-1' : String(hls.currentLevel);
  }

  function destroyPlayback() {
    if (S.hls) {
      try { S.hls.destroy(); } catch (e) {}
      S.hls = null;
    }
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
    S.playing = false;
  }

  function stopAll() {
    destroyPlayback();
    // 取消排队与在途任务
    const queued = S.queue.splice(0, S.queue.length);
    queued.forEach((t) => t.reject(ABORT));
    S.running.forEach((t) => { try { t.ctrl.abort(); } catch (e) {} });
    S.inflight.clear();
    clearCache();
    // 取消待执行的重试，避免用户点了停止后又被自动拉起
    if (S.retryTimer) { clearTimeout(S.retryTimer); S.retryTimer = null; }
    S.currentUrl = '';
    $('quality').innerHTML = '<option value="-1">自动</option>';
    $('bRes').textContent = '-';
    $('bRate').textContent = '-';
    $('liveHint').textContent = '已停止';
    setOverlay('已停止播放，粘贴新的 <b>m3u8</b> 地址可重新开始。', false);
  }

  function startPlayback(rawUrl, isRetry) {
    const url = (rawUrl || '').trim();
    if (!url) {
      log('请输入 m3u8 地址', 'warn');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      log('仅支持 http/https 地址', 'warn');
      setOverlay('仅支持 <b>http/https</b> 地址；本地文件请先通过服务托管。', false);
      return;
    }

    stopAll();
    S.currentUrl = url;
    if (!isRetry) { S.manifestRetry = 0; S.netRetry = 0; }
    S.net.downloads = 0; S.net.bytes = 0; S.net.errors = 0; S.net.prefetched = 0;
    S.net.playerReqs = 0; S.net.hits = 0; S.net.activePeak = 0; S.net.bwEwma = 0;
    S.spark = [];
    S.speed = { bytes: 0, ts: now(), current: 0 };

    setOverlay('正在加载播放列表…<br /><span style="font-size:11px;opacity:.6">' + url + '</span>', true);
    $('liveHint').textContent = '加载中';
    log('开始加载：' + url);

    if (window.__nativeHls && (!window.Hls || !window.Hls.isSupported())) {
      // Safari 原生 HLS
      video.src = url;
      video.play().catch(() => {});
      setOverlay('已交由浏览器原生 HLS 播放（无并发统计）。', true);
      $('liveHint').textContent = '原生模式';
      log('使用原生 HLS 播放', 'warn');
      return;
    }

    if (!window.Hls) {
      setOverlay('hls.js 未就绪，请刷新页面重试。', false);
      return;
    }
    if (!window.Hls.isSupported()) {
      setOverlay('当前浏览器不支持 MSE，无法使用并发播放模式。', false);
      return;
    }

    const hls = new window.Hls({
      loader: PrefetchLoader,
      fLoader: PrefetchLoader,
      pLoader: PrefetchLoader,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 45,
      maxBufferLength: 90,
      maxMaxBufferLength: 180,
      maxBufferSize: 120 * 1024 * 1024,
      fragLoadingMaxRetry: 4,
      fragLoadingRetryDelay: 600,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingTimeOut: 30000,
      startLevel: -1
    });
    S.hls = hls;
    window.__hls = hls;

    hls.on(window.Hls.Events.MANIFEST_PARSED, (evt, data) => {
      S.manifestRetry = 0;
      S.netRetry = 0;
      log('播放列表解析完成：' + data.levels.length + ' 个码率档位', 'ok');
      populateQuality();
      updateLevelBadges();
      $('liveHint').textContent = '播放中';
      setOverlay('正在起播…', true);
      video.play().catch(() => setOverlay('已就绪，点击播放按钮开始。', false));
    });

    hls.on(window.Hls.Events.LEVEL_SWITCHED, () => updateLevelBadges());

    hls.on(window.Hls.Events.FRAG_LOADED, (evt, data) => {
      if (data && data.frag) {
        // 仅在切到新分片时输出，避免日志刷屏
        const sn = data.frag.sn;
        if (S.__lastSn !== sn) {
          S.__lastSn = sn;
          log('分片 #' + sn + ' 就绪（' + fmtBytes(data.frag.__bytes || 0) + '）');
        }
      }
    });

    hls.on(window.Hls.Events.ERROR, (evt, data) => {
      // data.response 是我们 Loader 传出的 { code, text }，其中 text 才是真实原因
      const reason = (data.response && data.response.text) ||
                     (data.error && data.error.message) || '未知错误';
      const label = data.details || '';
      if (!data.fatal) {
        log('提示：' + label + ' · ' + reason, 'warn');
        return;
      }
      log('致命错误：' + label + ' · ' + reason, 'err');

      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        // 播放列表拿不到时 hls.startLoad() 无效，必须重新加载源
        if (/manifest|level|manifestLoad|levelLoad/i.test(label) && !/frag/i.test(label)) {
          retryManifest(reason);
          return;
        }
        if (S.netRetry < 3) {
          S.netRetry++;
          setOverlay('网络异常，正在重试（' + S.netRetry + '/3）…<br />' +
            '<span style="font-size:11.5px;opacity:.75">' + reason + '</span>', true);
          setTimeout(() => {
            if (!S.hls) return;
            try { S.hls.startLoad(); } catch (e) {}
          }, 800 * S.netRetry);
          return;
        }
      } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        setOverlay('媒体解码错误，正在恢复…<br />' +
          '<span style="font-size:11.5px;opacity:.75">' + reason + '</span>', true);
        try { hls.recoverMediaError(); } catch (e) {}
        return;
      }

      giveUp(reason);
    });

    hls.loadSource(url);
    hls.attachMedia(video);
  }

  /** 播放列表加载失败：按 2s / 4s / 8s 退避重建播放器，最多 3 次 */
  function retryManifest(reason) {
    if (S.manifestRetry >= 3) { giveUp(reason); return; }
    S.manifestRetry++;
    const wait = Math.min(2000 * Math.pow(2, S.manifestRetry - 1), 8000);
    setOverlay(
      '播放列表加载失败，' + (wait / 1000) + ' 秒后自动重试（第 ' + S.manifestRetry + '/3 次）…<br />' +
      '<span style="font-size:11.5px;opacity:.75">' + reason + '</span><br />' +
      '<span style="font-size:11px;opacity:.5">' + hintFor(reason) + '</span>', true);
    log('播放列表加载失败，' + (wait / 1000) + 's 后重试：' + reason, 'warn');
    S.retryTimer = setTimeout(() => {
      if (S.currentUrl) startPlayback(S.currentUrl, true);
    }, wait);
  }

  async function giveUp(reason) {
    log('已停止尝试：' + reason, 'err');
    $('liveHint').textContent = '播放失败';

    const url = S.currentUrl;
    if (S.hls) { try { S.hls.destroy(); } catch (e) {} S.hls = null; }

    setOverlay(
      '<b>播放失败</b><br />' +
      '<span style="font-size:12px;opacity:.85">' + reason + '</span><br />' +
      '<span style="font-size:11.5px;opacity:.5">正在诊断原因…</span>', false);

    // 浏览器在被 CORS 拦截时不会暴露状态码，这里再探测一次以区分「不可达 / 缺 CORS 头」
    let diag = null;
    if (url && /Failed to fetch|NetworkError|Load failed/i.test(reason)) {
      diag = await probeReachability(url);
    }
    if (S.currentUrl !== url && url) return; // 期间用户已切换地址，不要覆盖新的提示

    setOverlay(
      '<b>播放失败</b><br />' +
      '<span style="font-size:12px;opacity:.85">' + reason + '</span><br />' +
      '<span style="font-size:11.5px;opacity:.55">' + hintFor(reason, diag) + '</span>', false);
  }

  Object.assign(M3U8, {
    populateQuality, updateLevelBadges,
    destroyPlayback, stopAll, startPlayback,
    retryManifest, giveUp
  });
})();
