const { contextBridge, ipcRenderer } = require('electron');

// 只向页面暴露代理相关的两个方法（保持 contextIsolation）
// 自定义 UA
contextBridge.exposeInMainWorld('uaApi', {
  // cfg: { enabled, value }，enabled=false 时恢复默认
  setUa: (cfg) => ipcRenderer.invoke('ua:set', cfg),
  // 读取已保存的 UA 配置（含默认值）
  getUa: () => ipcRenderer.invoke('ua:get'),
  available: () => ipcRenderer.invoke('ua:available')
});

contextBridge.exposeInMainWorld('proxyApi', {
  // 设置代理；cfg: { enabled, type, host, port, user, pass }
  // enabled=false 时清除代理
  setProxy: (cfg) => ipcRenderer.invoke('proxy:set', cfg),
  // 读取已保存的代理配置（用于启动时回填表单）
  getProxy: () => ipcRenderer.invoke('proxy:get'),
  // 返回 true 表示这是 Electron 桌面环境、代理 IPC 可用
  available: () => ipcRenderer.invoke('proxy:available')
});
