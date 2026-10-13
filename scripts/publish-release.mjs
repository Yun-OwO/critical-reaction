#!/usr/bin/env node
/**
 * 发布 APK 到 GitHub Release（gh CLI 未安装时用 REST API）
 *
 * 用法：
 *   node scripts/publish-release.mjs <tag> <apk路径> [说明]
 *
 * 例：
 *   node scripts/publish-release.mjs v0.2.3 android/app/build/outputs/apk/debug/app-debug.apk
 *
 * 行为：
 *   1. 读 ~/.ghtoken 作为鉴权（需 repo 权限）
 *   2. 若该 tag 的 release 不存在则创建，存在则复用
 *   3. 上传 APK 为 release asset（同名已存在会先删旧的）
 *   4. 输出 release 页面 URL
 *
 * 注意：本脚本只调 api.github.com，不走 gh-proxy（proxy 用于 git push，不适用 API）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const REPO = 'Yun-OwO/critical-reaction';

const [tag, apkPath, ...noteParts] = process.argv.slice(2);
if (!tag || !apkPath) {
  console.error('用法: node scripts/publish-release.mjs <tag> <apk路径> [说明]');
  process.exit(2);
}
if (!existsSync(apkPath)) {
  console.error(`APK 不存在: ${apkPath}`);
  process.exit(2);
}

const token = readFileSync(resolve(homedir(), '.ghtoken'), 'utf8').trim();
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'critical-reaction-release-script'
};

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  return res;
}

async function main() {
  // 1. 找 release
  let release = null;
  const listRes = await gh(`/repos/${REPO}/releases?per_page=100`);
  if (!listRes.ok) {
    console.error('列出 release 失败:', listRes.status, (await listRes.text()).slice(0, 300));
    process.exit(1);
  }
  const list = await listRes.json();
  release = list.find((r) => r.tag_name === tag) ?? null;

  if (!release) {
    const body = noteParts.join(' ') || `临界反应 ${tag}`;
    const createRes = await gh(`/repos/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body,
        draft: false,
        prerelease: false
      })
    });
    if (!createRes.ok) {
      console.error('创建 release 失败:', createRes.status, (await createRes.text()).slice(0, 400));
      process.exit(1);
    }
    release = await createRes.json();
    console.log('✓ 已创建 release:', tag);
  } else {
    console.log('✓ 复用已有 release:', tag);
  }

  // 2. 删除同名旧 asset（重复上传会 422）
  const assetName = basename(apkPath);
  const old = (release.assets || []).find((a) => a.name === assetName);
  if (old) {
    const delRes = await gh(`/repos/${REPO}/releases/assets/${old.id}`, { method: 'DELETE' });
    console.log(delRes.ok || delRes.status === 204 ? `✓ 已删除旧 asset: ${assetName}` : `! 删除旧 asset 失败: ${delRes.status}`);
  }

  // 3. 上传
  const buf = readFileSync(apkPath);
  const sizeMB = (statSync(apkPath).size / 1024 / 1024).toFixed(1);
  console.log(`↑ 上传 ${assetName} (${sizeMB} MB)...`);
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, '');
  const upRes = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(buf.length)
    },
    body: buf
  });
  if (!upRes.ok) {
    console.error('上传失败:', upRes.status, (await upRes.text()).slice(0, 500));
    process.exit(1);
  }
  const asset = await upRes.json();
  console.log('✓ 上传成功:', asset.name);
  console.log('\nRelease:', release.html_url);
  console.log('APK 直链:', asset.browser_download_url);
}

main().catch((err) => {
  console.error('发布异常:', err);
  process.exit(1);
});