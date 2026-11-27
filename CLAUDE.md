# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

需要 Node.js 22.12+（electron 45 的 `engines` 要求；CI 固定用 Node 20 构建）。

```bash
npm ci          # 按锁文件安装依赖
npm run dev     # 构建主进程/预加载并启动 Electron
npm run build   # 用 electron-vite 构建 src/ 到 out/
npm run start   # 预览构建产物
npm run pack    # 打包未压缩目录（当前平台）
npm run dist    # 打包当前平台安装包：macOS 出 DMG，Windows 出 NSIS exe
```

仓库没有测试框架，也没有 lint 配置。验证改动只能靠 `npm run build` 排除编译错误，再用 `npm run dev` 手动播放界面内置的三个示例源；安装包构建由 CI 负责。

## 架构

三个部分，渲染层刻意不引入打包器：

### 1. 主进程 `src/main/index.js`（CommonJS）

- 创建唯一窗口，`webPreferences` 中 `webSecurity: false`，这是桌面版能播「缺少 CORS 头」的 m3u8 源的根本原因；`nodeIntegration: false` + `contextIsolation: true`。
- 实际加载的是仓库根目录的 `m3u8-player.html`（`win.loadFile`），不是 `src/renderer/`。
- 代理与 UA 配置持久化在 `app.getPath('userData')/settings.json`，启动时 `loadSettings()` 读回，通过 `session.setProxy` / `webRequest.onBeforeSendHeaders` 应用到窗口会话。渲染进程只负责表单，不持有配置。
- 外链一律 `shell.openExternal`，单实例锁，各平台统一使用中文应用菜单（macOS 显示在系统顶栏，Windows/Linux 由 `autoHideMenuBar` 收起、按 Alt 弹出）。

### 2. 预加载 `src/preload/index.js`

通过 `contextBridge` 只暴露 `proxyApi`（set/get/available）和 `uaApi`（set/get/available）。新增主进程能力时，需要同时改主进程 IPC、preload 暴露、渲染层；并且渲染层要像 `js/settings.js` 那样检测 `window.proxyApi` 不存在（浏览器直接打开页面）时禁用相关控件。

### 3. 渲染层：根目录 `m3u8-player.html` + `js/*.js`

- 传统 `<script>` 按依赖顺序加载：`core → cache → downloader → engine → player → controls → settings → dashboard → app`。新增模块若被其它模块在加载期解构（`const { x } = M3U8`），必须排在依赖之后，并同步修改 `m3u8-player.html` 底部的脚本列表。
- 每个文件是一个 IIFE，向 `window.M3U8` 挂导出；全部共享 `core.js` 里的全局状态 `S`（并发数、预取数、缓存、队列、网络计数等）。
- `src/renderer/index.html` 只是满足 electron-vite 目录约定的占位页，不要删除，也不要往里搬逻辑。
- `js/hls.min.js` 是本地 vendored 的 hls.js；`engine.js` 只从本地加载，失败时回退 Safari 原生 HLS（无统计），不走 CDN。

### 网络层（`js/downloader.js`）是核心，改动前先读全文

- `PrefetchLoader` 作为 `loader` / `fLoader` / `pLoader` 接管 hls.js 全部网络请求：
  - 播放列表（manifest / level / audio / subtitle track）直接 `fetch`、`cache: 'no-store'`，不缓存，保证直播拿最新。
  - 视频切片走 `requestSegment` → 优先级队列（`priority 0` 播放器请求插队，`2` 预取排队尾）→ `runTask` 并发执行；同一 `cacheKey`（URL + Range）的在途请求合并，命中 LRU 缓存直接返回。
  - LL-HLS 的 part 例外：不缓存、不去重、随 abort 取消。
- 交给 hls.js 的 `ArrayBuffer` 必须 `.slice(0)` 拷贝：hls.js 会 transfer 给 worker 并 detach 原 buffer，缓存里的原数据不能直接交出去。
- 缓存命中时需要 `fillStats` 按 EWMA 带宽合成等效耗时，否则 ABR 会把「零耗时」当成无限带宽而乱切码率；`loader.stats` 要原地 `Object.assign` 重置，替换对象会让 hls.js 持有的 `frag.stats` 读到旧值。
- 失败诊断在 `core.js`：`hintFor` + `probeReachability` 用于区分「不可达」和「缺 CORS 头」；播放列表按 2/4/8 秒退避重试最多 3 次，网络错误重试 3 次，媒体错误走 `recoverMediaError`。

## 构建与发布

- `electron.vite.config.js` 的 renderer 只对应占位页，真正的页面不经过 Vite；主进程和预加载构建到 `out/`。
- 发布完全由 `.github/workflows/release.yml` 驱动：
  - 推送到 main（改 `docs/**` 或 `*.md` 不触发）→ `prepare` 按最新 `v*` tag 计算 patch +1、执行 `npm version` 提交、打 tag 推送 → 矩阵构建 → 汇总发布 Release。也可手动打 tag 或跑 `workflow_dispatch`。
  - 构建矩阵目前只有 `macos-latest`（`--mac dmg --arm64`）和 `windows-latest`（`--win nsis`）。要增删平台需同步四处：`package.json` 的 `build.*`、工作流矩阵、上传/发布的 glob（`dist/*.dmg`、`dist/*.exe`）、README。
  - macOS 没有开发者证书：`scripts/after-pack.js` 在签名无效时用 ad-hoc 证书完整封印（否则 TCC 会丢弃本地网络权限）；CI 的 Verify 步骤会校验 `.app` 的 `codesign --verify`、`_CodeSignature`、`Info.plist` 中 `NSLocalNetworkUsageDescription`，并真实挂载 DMG。
  - `package.json` 版本号由 CI 发布时自动递增并提交，通常不需要手改。

## 约定与易错点

- 界面、日志、注释全部用中文；应用名统一用主进程里的 `APP_NAME` 常量。
- 桌面端与浏览器端共用同一个页面：新增依赖主进程的功能必须提供降级路径。
- 调试：浏览器打开页面时在 URL 加 `?debug=1`，控制台执行 `__dbg()` 读网络层调试记录（该开关在 Electron 中默认不生效）。
- 代码全部用 `'use strict'` + IIFE，没有 ES module / bundler；不要写 `import` 语句。
- `node_modules/`、`out/`、`dist/` 已被忽略；`package-lock.json` 参与 CI 的 `npm ci`，改动依赖时保持同步。
