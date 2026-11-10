# m3u8-player

## 发布新版本

发布流程会构建 macOS（zip）、Windows（nsis exe）、Linux（AppImage）安装包，并发布到 GitHub Releases。三种触发方式：

1. **push 到 main（默认）**：推送/合并到 main 即自动发布；只改 `docs/**` 或 `*.md` 的推送不触发。
2. **一键发布**：仓库 Actions 页 → `Release` → `Run workflow`。
3. **手动打 tag**：`git tag v1.0.1 && git push origin v1.0.1`。CI 以该 tag 的版本号构建并发布。

版本号规则：首次 `v1.0.0`，之后每次发布 patch +0.0.1（`v1.0.1` → `v1.0.2`）。自动发布时会同步更新 `package.json` 版本并提交；release notes 由 GitHub 根据上个 tag 以来的提交自动生成。
