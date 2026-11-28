# M3U8 播放器

基于 Electron 的桌面 M3U8 / HLS 播放器：粘贴地址即可播放，带并发下载调度、切片预取缓存、网络代理、自定义 UA，以及实时带宽与缓存命中统计。

[![Release](https://img.shields.io/github/v/release/Finder0519/m3u8-player)](https://github.com/Finder0519/m3u8-player/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20arm64%20%7C%20Windows%20x64-informational)](#下载安装)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## 为什么用桌面版

浏览器里播 m3u8 受同源策略限制：目标服务器不返回 `Access-Control-Allow-Origin` 就无法播放。桌面版关闭了 `webSecurity`，直接绕过这一限制；此外还能设置系统级代理和 User-Agent——这两件事网页版做不到。

## 功能

- **直接播放**：点播 / 直播，AES-128 加密、fMP4、多音轨与字幕（hls.js 内置在本地，不依赖 CDN）
- **并发下载调度**：自写 hls.js Loader 接管网络层，1–16 并发；播放器请求插队、预取排队尾、同一地址在途请求自动合并
- **切片预取 + LRU 缓存**：提前下载当前片段之后的切片，命中缓存时折算等效耗时喂回 ABR，避免码率被误判为无限带宽
- **画质切换**：自动 / 手动档位，实时显示分辨率、码率、缓冲与命中率
- **实时数据面板**：下载速度曲线、缓存命中率、活动线程、预取与失败次数、事件日志
- **网络代理**：三档可选——不使用代理、跟随系统设置（默认）、自定义 HTTP / SOCKS5（支持用户名密码），配置持久化
- **自定义 UA**：默认伪装成 Windows Chrome，改写本应用发出的所有请求头
- **失败诊断**：播放列表按 2/4/8 秒退避重试，并区分「网络不可达」与「缺少 CORS 头」
- **桌面体验**：单实例运行、外链交给系统浏览器、使用 Electron 默认菜单

## 下载安装

安装包在 [GitHub Releases](https://github.com/Finder0519/m3u8-player/releases/latest) 发布，文件名形如 `m3u8-player-<version>-mac-arm64.dmg`。

| 平台 | 架构 | 安装包 | 说明 |
| --- | --- | --- | --- |
| macOS | Apple Silicon（arm64） | DMG | 拖入「应用程序」即可 |
| Windows | x64 | NSIS exe | 双击安装 |

两个平台的安装包都没有开发者证书签名：

- **macOS** 只做了 ad-hoc 签名、未公证，首次打开会提示「无法验证开发者」。在应用上右键 →「打开」，或到「系统设置 → 隐私与安全性」点「仍要打开」。
- **Windows** 未做代码签名，SmartScreen 可能拦截，点「更多信息 → 仍要运行」。

> 发布范围：自下一个版本起只构建 macOS arm64 和 Windows x64；更早的 Release 里仍能看到 `mac-x64` DMG 和 Linux AppImage 产物。

## 使用

1. 打开应用，把 m3u8 地址（仅支持 http/https）粘贴到顶部输入框，点「加载播放」或按回车。
2. 界面内置三个示例源（Mux 多码率、fMP4、多音轨 + 字幕），可直接点开验证。
3. 右侧面板全部即时生效：

| 设置 | 范围 | 作用 |
| --- | --- | --- |
| 并发线程数 | 1–16 | 同时在途的 HTTP 请求数 |
| 预取数量 | 0–12 | 当前片段之后提前下载几个切片 |
| 缓存上限 | 40–1000 MB | 内存缓存上限，超出按 LRU 淘汰 |
| 预取缓存 | 开 / 关 | 关闭后只按播放器请求下载 |

下半部分可配置网络代理和浏览器 UA（仅在桌面版生效，配置保存在应用数据目录，重启后回填）。

**同一个页面也能在浏览器里直接打开**：`m3u8-player.html` 是完整的单页应用，用静态服务器托管后访问即可。但浏览器模式没有代理和自定义 UA，且受 CORS 限制，只能播放返回了 `Access-Control-Allow-Origin` 的源。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 提示跨域 / `Failed to fetch` | 浏览器模式需服务器返回 CORS 头；桌面版不会因 CORS 失败。若仍失败，多半是地址不可达或需要鉴权 |
| 403 / 防盗链 | 尝试在「浏览器 UA」里换成目标站点认可的客户端 UA。本应用只改 UA，**不支持自定义 Referer** |
| 本地 m3u8 文件播不了 | 只接受 http/https；本地文件请先用任意静态服务器托管 |
| 起播慢、拖动后卡顿 | 调高并发线程数与预取数量，并确认缓存上限足够 |
| 加密流无法播放 | 支持 HLS AES-128；依赖 DRM（Widevine / FairPlay）的流未集成相应模块，无法播放 |
| 代理设置无效 | 代理与 UA 只在 Electron 桌面版中可用；浏览器打开页面时相关按钮会被禁用 |

调试：在浏览器中访问页面地址后加 `?debug=1`，控制台执行 `__dbg()` 可查看网络层调试记录。

## 开发

需要 Node.js 22.12 或更高版本。

```bash
npm ci          # 安装依赖
npm run dev     # 开发模式：构建主进程/预加载并启动 Electron（页面改动需手动重新加载）
npm run build   # 构建主进程与预加载脚本到 out/
npm run start   # 预览构建产物
npm run pack    # 打包未压缩目录
npm run dist    # 打包当前平台的安装包（macOS 出 DMG，Windows 出 exe）
```

渲染层是根目录的 `m3u8-player.html` 加 `js/` 下的 9 个脚本，以传统 `<script>` 方式加载、挂在 `window.M3U8` 命名空间上，**不经过 Vite 打包**；`src/renderer/index.html` 只是为了满足 electron-vite 目录约定的占位页，实际不会被加载。

### 目录结构

```text
├─ src/main/index.js       主进程：窗口、代理、UA、单实例锁
├─ src/preload/index.js    contextBridge 暴露 proxyApi / uaApi
├─ m3u8-player.html        渲染层页面（也是浏览器可用的完整界面）
├─ js/                     渲染层脚本
│  ├─ core.js              全局状态与工具、网络诊断
│  ├─ cache.js             LRU 切片缓存
│  ├─ downloader.js        并发调度、预取、自定义 hls.js Loader
│  ├─ engine.js            本地加载 hls.js，失败时回退原生 HLS
│  ├─ player.js            播放控制、重试与错误处理
│  ├─ controls.js          界面交互绑定
│  ├─ settings.js          代理与 UA 表单
│  ├─ dashboard.js         速度曲线与实时指标
│  └─ app.js               启动入口
├─ build/                  应用图标
├─ scripts/after-pack.js   macOS ad-hoc 签名兜底
└─ .github/workflows/release.yml  构建与发布流水线
```

## 发布新版本

发布流程会构建 macOS（DMG，arm64）与 Windows（NSIS exe）安装包并发布到 GitHub Releases。三种触发方式：

1. **push 到 main（默认）**：推送/合并到 main 即自动发布；只改 `docs/**` 或 `*.md` 的推送不触发。
2. **一键发布**：仓库 Actions 页 → `Release` → `Run workflow`。
3. **手动打 tag**：`git tag v1.0.1 && git push origin v1.0.1`。CI 以该 tag 的版本号构建并发布。

版本号规则：首次 `v1.0.0`，之后每次发布 patch +0.0.1（`v1.0.1` → `v1.0.2`）。自动发布时会同步更新 `package.json` 版本并提交；release notes 由 GitHub 根据上个 tag 以来的提交自动生成。

## 许可

MIT License，见 [LICENSE](LICENSE)。
