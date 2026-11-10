# m3u8-player

## 发布新版本

发布流程会构建 macOS（zip）、Windows（nsis exe）、Linux（AppImage）安装包，并发布到 GitHub Releases。两种触发方式：

1. **一键发布（推荐）**：仓库 Actions 页 → `Release` → `Run workflow`。自动计算版本号（首次 `v1.0.0`，之后每次 patch +0.0.1，即 `v1.0.0` → `v1.0.1`），更新 `package.json` 版本、提交、打 tag 并发布 Release。
2. **手动打 tag**：`git tag v1.0.1 && git push origin v1.0.1`。CI 以该 tag 的版本号构建并发布。

Release notes 由 GitHub 根据上个 tag 以来的提交自动生成。
