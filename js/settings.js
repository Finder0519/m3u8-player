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
  const proxyFields = ['proxyType', 'proxyHost', 'proxyPort', 'proxyUser', 'proxyPass'];
  const systemModeId = 'proxySystemToggle';

  function proxyStatusEl() { return $('proxyStatus'); }

  function setProxyStatus(text, on) {
    const el = proxyStatusEl();
    el.textContent = text;
    el.className = 'p-status' + (on ? ' on' : '');
  }

  // 切换「跟随系统代理」：开启时禁用自定义代理表单
  function setProxyMode(mode) {
    const system = mode === 'system';
    $(systemModeId).classList.toggle('on', system);
    proxyFields.forEach((id) => { $(id).disabled = system; });
  }

  // 读取当前表单值
  function readProxyForm() {
    return {
      enabled: false,
      mode: $(systemModeId).classList.contains('on') ? 'system' : 'custom',
      type: $('proxyType').value,
      host: ($('proxyHost').value || '').trim(),
      port: Number($('proxyPort').value) || 0,
      user: ($('proxyUser').value || '').trim(),
      pass: $('proxyPass').value || ''
    };
  }

  // 校验并提交到主进程
  async function applyProxy() {
    const cfg = readProxyForm();
    if (cfg.mode === 'custom') {
      if (!cfg.host) {
        log('代理：请先填写主机地址', 'warn');
        return;
      }
      if (!(cfg.port >= 1 && cfg.port <= 65535)) {
        log('代理：端口需在 1~65535 之间', 'warn');
        return;
      }
    }
    cfg.enabled = true;
    const label = cfg.mode === 'system' ? '跟随系统' : cfg.type.toUpperCase();
    try {
      await window.proxyApi.setProxy(cfg);
      setProxyStatus('已启用 · ' + label);
      log(cfg.mode === 'system'
        ? '代理已启用：跟随系统设置'
        : '代理已应用：' + cfg.type + '://' + cfg.host + ':' + cfg.port, 'ok');
    } catch (e) {
      setProxyStatus('应用失败', false);
      log('代理应用失败：' + (e && e.message || e), 'err');
    }
  }

  // 关闭代理
  async function clearProxy() {
    try {
      await window.proxyApi.setProxy({ enabled: false });
      setProxyStatus('已关闭', false);
      log('代理已关闭，恢复直连');
    } catch (e) {
      log('关闭代理失败：' + (e && e.message || e), 'err');
    }
  }

  $('proxyApply').addEventListener('click', applyProxy);
  $('proxyClear').addEventListener('click', clearProxy);
  $(systemModeId).addEventListener('click', () => {
    setProxyMode($(systemModeId).classList.contains('on') ? 'custom' : 'system');
  });
  // 按回车快捷应用
  ['proxyType', 'proxyHost', 'proxyPort'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') applyProxy(); });
  });

  // 非桌面环境（直接用浏览器打开页面）时，代理走不了主进程，禁用该功能
  if (!window.proxyApi) {
    setProxyStatus('仅桌面版可用');
    $('proxyApply').disabled = true;
    $('proxyClear').disabled = true;
    $(systemModeId).disabled = true;
  }

  // 启动时把已保存的代理配置同步回表单（让页面值与真实生效的代理一致）
  if (window.proxyApi) {
    window.proxyApi.getProxy().then((saved) => {
      if (!saved) return;
      setProxyMode(saved.mode === 'system' ? 'system' : 'custom');
      $('proxyType').value = saved.type === 'socks5' ? 'socks5' : 'http';
      $('proxyHost').value = saved.host || '';
      $('proxyPort').value = saved.port || '';
      $('proxyUser').value = saved.user || '';
      $('proxyPass').value = saved.pass || '';
      if (saved.enabled && (saved.mode === 'system' || saved.host)) {
        setProxyStatus('已启用 · ' + (saved.mode === 'system' ? '跟随系统' : saved.type.toUpperCase()));
      }
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
