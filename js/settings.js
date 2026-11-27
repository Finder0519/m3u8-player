/* ============================================================
   settings.js
   网络代理 + 浏览器 UA（仅 Electron 桌面版可用）
   依赖：core.js（S / $ / log）
   导出：无（仅内部初始化 + 事件绑定）
   ============================================================ */
(() => {
  'use strict';
  const M3U8 = window.M3U8;
  const { $, log } = M3U8;

  /* ============================================================
     网络代理（仅 Electron 桌面版可用）
     ============================================================ */
  const customFieldIds = ['proxyType', 'proxyHost', 'proxyPort', 'proxyUser', 'proxyPass'];
  const modeButtons = () => Array.from(document.querySelectorAll('#proxyMode .seg-item'));

  function setProxyStatus(text, on) {
    const el = $('proxyStatus');
    el.textContent = text;
    el.className = 'p-status' + (on ? ' on' : '');
  }

  function currentMode() {
    const active = modeButtons().find((btn) => btn.classList.contains('on'));
    return active ? active.dataset.mode : 'system';
  }

  // 切换模式：更新选中态；只有「自定义」才允许编辑代理表单
  function setProxyMode(mode) {
    modeButtons().forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    customFieldIds.forEach((id) => { $(id).disabled = mode !== 'custom'; });
  }

  // 读取当前表单值
  function readProxyForm() {
    return {
      mode: currentMode(),
      type: $('proxyType').value,
      host: ($('proxyHost').value || '').trim(),
      port: Number($('proxyPort').value) || 0,
      user: ($('proxyUser').value || '').trim(),
      pass: $('proxyPass').value || ''
    };
  }

  // 与主进程一致的生效状态文案（自定义模式没填主机时主进程会退回直连）
  function statusFor(cfg) {
    if (cfg.mode === 'system') return { text: '已启用 · 跟随系统设置', on: true };
    if (cfg.mode === 'custom' && cfg.host) {
      return { text: '已启用 · ' + String(cfg.type || 'http').toUpperCase(), on: true };
    }
    return { text: '直连 · 不使用代理', on: false };
  }

  // 校验并提交到主进程
  async function applyProxy() {
    const cfg = readProxyForm();
    if (cfg.mode === 'custom') {
      if (!cfg.host) {
        log('代理：自定义模式下请先填写主机地址', 'warn');
        return;
      }
      if (!(cfg.port >= 1 && cfg.port <= 65535)) {
        log('代理：端口需在 1~65535 之间', 'warn');
        return;
      }
    }
    try {
      await window.proxyApi.setProxy(cfg);
      const st = statusFor(cfg);
      setProxyStatus(st.text, st.on);
      if (cfg.mode === 'direct') {
        log('代理已关闭：直接连接');
      } else if (cfg.mode === 'system') {
        log('代理已启用：跟随系统设置');
      } else {
        log('代理已应用：' + cfg.type + '://' + cfg.host + ':' + cfg.port, 'ok');
      }
    } catch (e) {
      setProxyStatus('应用失败', false);
      log('代理应用失败：' + (e && e.message || e), 'err');
    }
  }

  modeButtons().forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === currentMode()) return;
      setProxyMode(mode);
      // 直连与跟随系统不需要额外输入，选中即生效；自定义填完表单再点「应用设置」
      if (mode === 'custom') {
        log('代理：填写自定义参数后点「应用设置」生效');
      } else {
        applyProxy();
      }
    });
  });
  $('proxyApply').addEventListener('click', applyProxy);
  // 按回车快捷应用
  ['proxyType', 'proxyHost', 'proxyPort'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') applyProxy(); });
  });

  // 非桌面环境（直接用浏览器打开页面）时，代理走不了主进程，禁用该功能
  if (!window.proxyApi) {
    setProxyStatus('仅桌面版可用', false);
    $('proxyApply').disabled = true;
    modeButtons().forEach((btn) => { btn.disabled = true; });
  }

  // 启动时把已保存的代理配置同步回表单（让页面值与真实生效的代理一致）
  if (window.proxyApi) {
    $('proxyHint').textContent = '仅影响本应用';
    window.proxyApi.getProxy().then((saved) => {
      if (!saved) return;
      // 兼容旧配置：只有 enabled 时按主进程同样的规则推断模式
      let mode = saved.mode;
      if (mode !== 'direct' && mode !== 'system' && mode !== 'custom') {
        mode = saved.enabled === false ? 'direct' : (saved.host ? 'custom' : 'system');
      }
      setProxyMode(mode);
      $('proxyType').value = saved.type === 'socks5' ? 'socks5' : 'http';
      $('proxyHost').value = saved.host || '';
      $('proxyPort').value = saved.port || '';
      $('proxyUser').value = saved.user || '';
      $('proxyPass').value = saved.pass || '';
      const st = statusFor({ mode, type: saved.type, host: saved.host });
      setProxyStatus(st.text, st.on);
    }).catch(() => {});
  }

  /* ============================================================
     浏览器 UA（仅 Electron 桌面版可用）
     ============================================================ */
  let uaState = { enabled: false, defaultValue: '' };

  function uaToggleOn(on) {
    const t = $('uaToggle');
    t.classList.toggle('on', on);
    $('uaHint').textContent = on ? '已启用' : '默认模仿 Windows Chrome';
  }

  async function applyUa() {
    const value = ($('uaInput').value || '').trim();
    if (!value) {
      log('UA：不能为空', 'warn');
      return;
    }
    const enabled = $('uaToggle').classList.contains('on');
    try {
      await window.uaApi.setUa({ enabled, value });
      uaToggleOn(enabled);
      log('自定义 UA 已' + (enabled ? '启用' : '恢复默认'));
    } catch (e) {
      log('UA 应用失败：' + (e && e.message || e), 'err');
    }
  }

  async function resetUa() {
    $('uaInput').value = uaState.defaultValue || '';
    try {
      await window.uaApi.setUa({ enabled: true, value: uaState.defaultValue || $('uaInput').value });
      uaToggleOn(true);
      log('UA 已恢复为默认值');
    } catch (e) {
      log('UA 应用失败：' + (e && e.message || e), 'err');
    }
  }

  $('uaApply').addEventListener('click', applyUa);
  $('uaReset').addEventListener('click', resetUa);
  $('uaToggle').addEventListener('click', () => uaToggleOn(!$('uaToggle').classList.contains('on'))); // 仅切换显式状态，交「应用 UA」生效

  // 非桌面环境禁用
  if (!window.uaApi) {
    uaToggleOn(false);
    $('uaApply').disabled = true;
    $('uaReset').disabled = true;
  } else {
    // 启动时回填已保存的 UA 配置
    window.uaApi.getUa().then((saved) => {
      uaState = saved || {};
      if (saved && saved.value) $('uaInput').value = saved.value;
      uaToggleOn(!!(saved && saved.enabled));
    }).catch(() => {});
  }
})();
