const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';

/* ============================================================
   代理配置：持久化 + 应用到会话
   ============================================================ */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

let proxy = { enabled: false, mode: 'custom', type: 'http', host: '', port: 7890, user: '', pass: '' };

// 自定义 UA：默认模仿 Windows Chrome（应对防盗链流）
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
let ua = { enabled: true, value: DEFAULT_UA }; // 默认启用，启动即用 Windows Chrome UA 拉流

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf-8');
    const saved = JSON.parse(raw);
    if (saved && typeof saved.proxy === 'object') proxy = Object.assign(proxy, saved.proxy);
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

// 把代理配置变成 Chromium 的 proxyRules 字符串
function buildProxyRules(cfg) {
  if (!cfg.host) return '';
  const scheme = cfg.type === 'socks5' ? 'socks5' : 'http';
  const auth = cfg.user && cfg.pass ? `${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.pass)}@` : '';
  return `${scheme}://${auth}${cfg.host}:${cfg.port}`;
}

// 把一个窗口的会话切到「直连」「跟随系统代理」或「指定代理」
function applyProxyTo(ses, cfg) {
  if (!cfg.enabled) {
    ses.setProxy({ mode: 'direct' }, () => {});
    return;
  }
  if (cfg.mode === 'system') {
    ses.setProxy({ mode: 'system' }, () => {});
    return;
  }
  const rules = buildProxyRules(cfg);
  const mode = rules ? 'fixed_servers' : 'direct';
  ses.setProxy({ mode, ...(rules ? { proxyRules: rules } : {}) }, () => {});
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
    title: 'M3U8 播放器',
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
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 页面加载完成后再显示窗口，避免白屏闪烁（与 webdav-browser 一致）
  win.on('ready-to-show', () => win.show());

  // 把已保存的代理、UA 应用到本窗口会话
  applyProxyTo(win.webContents.session, proxy);
  applyUaTo(win.webContents.session, ua);

  // 加载已有的播放器页面（保持单一源码，避免复制一份导致不同步）
  const page = path.join(__dirname, 'm3u8-player.html');
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

  // 菜单栏已不在窗口内显示（Windows/Linux 不设置应用菜单），无需再在全屏时切换

  return win;
}

/* ============================================================
   IPC：渲染进程（页面）<-> 主进程
   ============================================================ */
function registerIpc() {
  ipcMain.handle('proxy:set', (event, cfg) => {
    proxy = Object.assign({}, proxy, cfg || {});
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

// macOS 应用菜单：接近 Electron 默认完整菜单，但全部中文。
// 子项用 role 声明，Electron 会自动绑定快捷键（Cmd+C/V/X 等）。
// 仅 macOS 使用（显示在系统顶栏），Windows/Linux 由 autoHideMenuBar 隐藏。
function buildMenu() {
  const template = [
    // 应用菜单（macOS 特有，靠近程序名字/关于/退出都在这里）
    {
      label: 'M3U8 播放器',
      submenu: [
        { role: 'about', label: '关于 M3U8 播放器' },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 M3U8 播放器' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 M3U8 播放器' }
      ]
    },
    // 文件
    {
      label: '文件',
      submenu: [
        { role: 'close', label: '关闭窗口' }
      ]
    },
    // 编辑（必须有，Cmd+C/V/X、右键复制粘贴才生效）
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    // 查看
    {
      label: '查看',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    // 窗口（提供 Cmd+M 最小化、Cmd+` 切换窗口等快捷键）
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ];
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
    // macOS：应用菜单显示在系统顶栏，这里用构建好的中文完整菜单；
    // Windows/Linux：不设置自定义菜单，用默认菜单 + autoHideMenuBar 隐藏。
    if (isMac) {
      Menu.setApplicationMenu(buildMenu());
    }
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
