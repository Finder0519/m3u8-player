import { defineConfig } from 'electron-vite'

// 最小 PoC：只接入 main + preload，renderer 走默认约定但暂不使用
// （主进程仍 loadFile 根目录的 m3u8-player.html，渲染层代码零改动）
export default defineConfig({
  main: {},
  preload: {},
  renderer: {}
})
