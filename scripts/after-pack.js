'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// electron-builder afterPack 钩子（仅 macOS）：
// 未配置开发者证书时 electron-builder 会跳过真正的 codesign 封印，
// 产物只有 arm64 链接器级 ad-hoc 签名（codesign --verify 会失败），
// 导致 macOS 15 的「本地网络」权限无法归属到该应用（TCC 静默丢弃局域网连接）。
// 这里在打包阶段兜底：签名无效时用 ad-hoc 证书完整封印 bundle。
module.exports = async function (context) {
  if (process.platform !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  try {
    // 已有有效签名（例如后续配置了开发者证书）就不需要处理
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'ignore' });
    return;
  } catch {
    // 签名无效，继续用 ad-hoc 证书封印
  }

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`[after-pack] 已对 ${appPath} 执行 ad-hoc 封印签名`);
};
