const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const APP_NAME = 'M3U8 播放器'

/* ============================================================
   代理配置：持久化 + 应用到会话
   ============================================================ */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// 代理三档：direct 不使用代理 / system 跟随系统设置（默认）/ custom 自定义 HTTP 或 SOCKS5
const PROXY_MODES = ['direct', 'system', 'custom'];
let proxy = { mode: 'system', type: 'http', host: '', port: 7890, user: '', pass: '' };

// 自定义 UA：默认模仿 Windows Chrome（应对防盗链流）
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
let ua = { enabled: true, value: DEFAULT_UA }; // 默认启用，启动即用 Windows Chrome UA 拉流

// 校验并补齐代理配置：模式、类型、端口都收敛到可用范围
function normalizeProxy(cfg) {
  const merged = Object.assign({}, proxy, cfg || {});
  const out = {
    mode: PROXY_MODES.includes(merged.mode) ? merged.mode : 'system',
    type: merged.type === 'socks5' ? 'socks5' : 'http',
    host: typeof merged.host === 'string' ? merged.host.trim() : '',
    port: Number(merged.port) || 0,
    user: typeof merged.user === 'string' ? merged.user : '',
    pass: typeof merged.pass === 'string' ? merged.pass : ''
  };
  return out;
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf-8');
    const saved = JSON.parse(raw);
    if (saved && typeof saved.proxy === 'object') {
      const sp = saved.proxy;
      // 兼容旧配置：enabled=false（旧版「关闭代理」）一律视为直连；
      // 没有 mode 的旧配置里，填过主机地址的视为自定义，其余跟随系统
      if (sp.enabled === false) {
        sp.mode = 'direct';
      } else if (!PROXY_MODES.includes(sp.mode)) {
        sp.mode = sp.host ? 'custom' : 'system';
      }
      proxy = normalizeProxy(sp);
    }
    if (saved && typeof saved.ua === 'object') {
      ua = Object.assign(ua, saved.ua);
      if (!ua.value) ua.value = DEFAULT_UA;
    }
  } catch (e) { /* 无配置或读失败，用默认值 */ }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ proxy, ua }, null, 2));
  } catch (e) { /* 忽略 */ }
}

// 把代理配置变成 Chromium 的 proxyRules 字符串；地址或端口无效时返回空串
function buildProxyRules(cfg) {
  if (!cfg.host || !(cfg.port >= 1 && cfg.port <= 65535)) return '';
  const scheme = cfg.type === 'socks5' ? 'socks5' : 'http';
  const auth = cfg.user && cfg.pass ? `${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.pass)}@` : '';
  return `${scheme}://${auth}${cfg.host}:${cfg.port}`;
}

// 把一个窗口的会话切到「直连」「跟随系统设置」或「自定义代理」
function applyProxyTo(ses, cfg) {
  if (cfg.mode === 'system') {
    ses.setProxy({ mode: 'system' }, () => {});
    return;
  }
  if (cfg.mode === 'custom') {
    const rules = buildProxyRules(cfg);
    // 自定义模式没填主机时退回直连，避免留下一个失效的代理规则
    if (rules) {
      ses.setProxy({ mode: 'fixed_servers', proxyRules: rules }, () => {});
      return;
    }
  }
  ses.setProxy({ mode: 'direct' }, () => {});
}

// 自定义 UA：用 webRequest 改写所有请求（含页面里的并发 fetch 拉流）的 User-Agent 头
function applyUaTo(ses, cfg) {
  try { ses.webRequest.onBeforeSendHeaders(null); } catch (e) {}
  if (!cfg.enabled || !cfg.value) return;
  const value = cfg.value;
  // 让 navigator.userAgent 与对外请求一致
  try { ses.setUserAgent(value); } catch (e) {}
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['User-Agent'] = value;
    cb({ requestHeaders: details.requestHeaders });
  });
}

/* ============================================================
   窗口
   ============================================================ */
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: '#070a0f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // 桌面播放器核心优势：关闭 webSecurity，绕过 CORS 跨域限制，
      // 让几乎所有 m3u8 源都能直接播放（网页版会因缺少
      // Access-Control-Allow-Origin 头而被浏览器拦截）。
      webSecurity: false,
      // 页面是纯前端、无 Node 依赖，关闭这些即可更安全
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, '../preload/index.js')
    }
  });

  // 页面加载完成后再显示窗口，避免白屏闪烁（与 webdav-browser 一致）
  win.on('ready-to-show', () => win.show());

  // 把已保存的代理、UA 应用到本窗口会话
  applyProxyTo(win.webContents.session, proxy);
  applyUaTo(win.webContents.session, ua);

  // 加载已有的播放器页面（保持单一源码，避免复制一份导致不同步）
  const page = path.join(__dirname, '../../m3u8-player.html');
  win.loadFile(page);

  // 拦截打开新窗口/外链：一律丢给系统浏览器，避免在窗口里乱跳
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // Windows/Linux 的菜单栏由 autoHideMenuBar 收起，无需在全屏时切换

  return win;
}

/* ============================================================
   IPC：渲染进程（页面）<-> 主进程
   ============================================================ */
function registerIpc() {
  ipcMain.handle('proxy:set', (event, cfg) => {
    proxy = normalizeProxy(cfg);
    saveSettings();
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) applyProxyTo(win.webContents.session, proxy);
    return { ok: true, proxy };
  });
  ipcMain.handle('proxy:get', () => proxy);
  ipcMain.handle('proxy:available', () => true);

  ipcMain.handle('ua:set', (event, cfg) => {
    ua = Object.assign({}, ua, cfg || {});
    if (!ua.value) ua.value = DEFAULT_UA;
    saveSettings();
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) applyUaTo(win.webContents.session, ua);
    return { ok: true, ua };
  });
  ipcMain.handle('ua:get', () => ({ ...ua, defaultValue: DEFAULT_UA }));
  ipcMain.handle('ua:available', () => true);
}

// 应用菜单：接近 Electron 默认完整菜单，但全部中文。
// 子项用 role 声明，Electron 会自动绑定快捷键（Cmd+C/V/X 等）。
// 平台差异只体现在「应用菜单」和「窗口」菜单上，其余共用。
function buildMenu() {
  const template = [];

  // 应用菜单（macOS 特有，靠近程序名字/关于/退出都在这里）
  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { label: `关于 ${APP_NAME}`, role: 'about' },
        { type: 'separator' },
        { label: `隐藏 ${APP_NAME}`, role: 'hide' },
        { label: '隐藏其他', role: 'hideOthers' },
        { type: 'separator' },
        { label: `退出 ${APP_NAME}`, role: 'quit' }
      ]
    });
  } else {
    // Windows/Linux 没有系统级应用菜单，退出按平台惯例放进「文件」
    template.push({
      label: '文件',
      submenu: [{ label: '退出', role: 'quit' }]
    });
  }

  // 编辑（必须有，Cmd+C/V/X、右键复制粘贴才生效）
  template.push({
    label: '编辑',
    submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ]
  });

  // 视图
  template.push({
    label: '视图',
    submenu: [
      { label: '重新加载', role: 'reload' },
      { label: '强制重新加载', role: 'forceReload' },
      { label: '开发者工具', role: 'toggleDevTools' },
      { type: 'separator' },
      { label: '实际大小', role: 'resetZoom' },
      { label: '放大', role: 'zoomIn' },
      { label: '缩小', role: 'zoomOut' },
      { type: 'separator' },
      { label: '切换全屏', role: 'togglefullscreen' }
    ]
  });

  // 窗口：macOS 的 zoom / front 角色仅在 macOS 生效，Windows 只保留最小化和关闭
  template.push({
    label: '窗口',
    submenu: isMac
      ? [
          { label: '最小化', role: 'minimize' },
          { label: '缩放', role: 'zoom' },
          { label: '关闭', role: 'close' },
          { type: 'separator' },
          { label: '前置全部窗口', role: 'front' }
        ]
      : [
          { label: '最小化', role: 'minimize' },
          { label: '关闭', role: 'close' }
        ]
  });

  return Menu.buildFromTemplate(template);
}

// 单实例锁：Windows 上再次打开程序时不另起窗口，而是聚焦已有窗口；
// macOS 本身单实例，此锁同样生效且不破坏「点 Dock 重建唯一窗口」的行为。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    registerIpc();
    // 所有平台统一使用中文菜单：macOS 显示在系统顶栏，
    // Windows/Linux 默认由 autoHideMenuBar 收起，按 Alt 弹出。
    Menu.setApplicationMenu(buildMenu());
    createWindow();

    app.on('activate', () => {
      // macOS：点击 Dock 图标时若无窗口则重建
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
