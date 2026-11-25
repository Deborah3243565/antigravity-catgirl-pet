/**
 * Gemini 星星猫娘桌宠 - 自动更新与一键配置工具
 * 支持检测 GitHub 远程最新版本/提交，并实现一键拉取、配置与热重载。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { execSync, spawn } = require('child_process');

const REPO = 'Deborah3243565/antigravity-catgirl-pet';
const RAW_PLUGIN_URL = `https://raw.githubusercontent.com/${REPO}/main/plugin.json`;
const COMMITS_API_URL = `https://api.github.com/repos/${REPO}/commits/main`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const ZIP_DOWNLOAD_URL = `https://codeload.github.com/${REPO}/zip/refs/heads/main`;

function getPluginDir() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const globalDir = path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet');
  if (fs.existsSync(globalDir)) {
    return globalDir;
  }
  // 回退至当前脚本所在目录的上级目录
  return path.resolve(__dirname, '..');
}

function getLocalVersionInfo(dir) {
  let version = '1.2.1';
  let commitSha = '';
  try {
    const pluginJsonPath = path.join(dir, 'plugin.json');
    if (fs.existsSync(pluginJsonPath)) {
      const p = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
      if (p.version) version = p.version;
    }
  } catch (e) {}

  try {
    if (fs.existsSync(path.join(dir, '.git'))) {
      commitSha = execSync('git rev-parse HEAD', { cwd: dir, timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    }
  } catch (e) {}

  return { version, commitSha };
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'antigravity-catgirl-pet-updater',
        'Cache-Control': 'no-cache'
      },
      timeout: 8000
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve);
      }
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null))
      .on('timeout', function() { this.destroy(); resolve(null); });
  });
}

function compareVersions(v1, v2) {
  const p1 = (v1 || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = (v2 || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * 检查是否有新版本
 */
async function checkUpdate() {
  const pluginDir = getPluginDir();
  const local = getLocalVersionInfo(pluginDir);
  const bust = Date.now();

  const [remoteCommit, latestRelease, latestTags] = await Promise.all([
    fetchJson(`${COMMITS_API_URL}?t=${bust}`),
    fetchJson(RELEASES_API_URL),
    fetchJson(`https://api.github.com/repos/${REPO}/tags?per_page=1`)
  ]);

  const remoteSha = remoteCommit?.sha || '';
  const shaPluginUrl = remoteSha
    ? `https://raw.githubusercontent.com/${REPO}/${remoteSha}/plugin.json`
    : `${RAW_PLUGIN_URL}?t=${bust}`;
  const remotePlugin = await fetchJson(shaPluginUrl);

  const candidates = [
    remotePlugin?.version,
    latestRelease?.tag_name?.replace(/^v/, ''),
    Array.isArray(latestTags) && latestTags[0]?.name ? latestTags[0].name.replace(/^v/, '') : ''
  ].filter(Boolean);

  let remoteVersion = local.version;
  for (const cand of candidates) {
    if (compareVersions(cand, remoteVersion) > 0) {
      remoteVersion = cand;
    }
  }
  if (candidates.length > 0 && remoteVersion === local.version && remotePlugin?.version) {
    remoteVersion = remotePlugin.version;
  }
  const commitMsg = remoteCommit?.commit?.message ? remoteCommit.commit.message.split('\n')[0] : '';
  const releaseTitle = latestRelease?.name || (latestRelease?.tag_name ? `版本 ${latestRelease.tag_name}` : '');
  const releaseNotes = latestRelease?.body || commitMsg || '功能优化与体验提升';
  const publishedAt = latestRelease?.published_at || remoteCommit?.commit?.committer?.date || new Date().toISOString();

  let hasUpdate = false;
  let updateReason = '';

  if (compareVersions(remoteVersion, local.version) > 0) {
    hasUpdate = true;
    updateReason = 'new_version';
  } else if (remoteSha && local.commitSha && remoteSha !== local.commitSha) {
    hasUpdate = true;
    updateReason = 'new_commit';
  }

  return {
    hasUpdate,
    updateReason,
    repo: REPO,
    currentVersion: local.version,
    currentCommit: local.commitSha ? local.commitSha.substring(0, 7) : '',
    latestVersion: remoteVersion,
    latestCommit: remoteSha ? remoteSha.substring(0, 7) : '',
    commitMessage: commitMsg,
    releaseTitle: releaseTitle || `v${remoteVersion} 最新更新`,
    releaseNotes,
    publishedAt,
    checkedAt: Date.now()
  };
}

/**
 * 一键更新与热配置
 */
async function applyUpdate() {
  const targetDirs = [];
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const globalDir = path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet');
  targetDirs.push(globalDir);

  const workspaceDir = path.resolve(__dirname, '..');
  if (path.resolve(globalDir).toLowerCase() !== path.resolve(workspaceDir).toLowerCase() && fs.existsSync(workspaceDir)) {
    targetDirs.push(workspaceDir);
  }

  const results = [];

  for (const dir of targetDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const hasGit = fs.existsSync(path.join(dir, '.git'));
      let updateMethod = 'git';

      if (hasGit) {
        try {
          // 尝试使用 git pull 进行无损增量更新
          execSync('git fetch origin main', { cwd: dir, timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] });
          execSync('git pull --rebase origin main', { cwd: dir, timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] });
        } catch (gitErr) {
          try {
            execSync('git reset --hard origin/main', { cwd: dir, timeout: 30000, stdio: ['pipe', 'pipe', 'ignore'] });
          } catch (e) {
            updateMethod = 'zip';
          }
        }
      } else {
        updateMethod = 'zip';
      }

      if (updateMethod === 'zip') {
        // Zip 兜底方案
        const tempZip = path.join(os.tmpdir(), `catgirl-pet-update-${Date.now()}.zip`);
        const tempExtract = path.join(os.tmpdir(), `catgirl-pet-extracted-${Date.now()}`);

        await downloadFile(ZIP_DOWNLOAD_URL, tempZip);

        if (process.platform === 'win32') {
          execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${tempExtract}' -Force"`, { timeout: 30000 });
        } else {
          execSync(`unzip -q -o "${tempZip}" -d "${tempExtract}"`, { timeout: 30000 });
        }

        const subdirs = fs.readdirSync(tempExtract);
        const extractedRoot = path.join(tempExtract, subdirs[0]);
        copyRecursiveSync(extractedRoot, dir);

        try { fs.unlinkSync(tempZip); } catch (e) {}
        try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch (e) {}
      }

      results.push({ dir, success: true, method: updateMethod });
    } catch (err) {
      results.push({ dir, success: false, error: err.message });
    }
  }

  // 触发 Antigravity 宿主热更新注入
  let reloaded = false;
  try {
    const injectScript = path.join(globalDir, 'scripts', 'inject_pet.js');
    if (fs.existsSync(injectScript)) {
      execSync(`node "${injectScript}"`, { timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] });
      reloaded = true;
    }
  } catch (e) {
    try {
      const localInject = path.join(__dirname, 'inject_pet.js');
      if (fs.existsSync(localInject)) {
        execSync(`node "${localInject}"`, { timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] });
        reloaded = true;
      }
    } catch (e2) {}
  }

  const updatedInfo = getLocalVersionInfo(globalDir);

  return {
    success: results.some(r => r.success),
    reloaded,
    version: updatedInfo.version,
    commit: updatedInfo.commitSha ? updatedInfo.commitSha.substring(0, 7) : '',
    results
  };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'antigravity-catgirl-pet-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // 保护用户个人配置，不被覆盖
    if (entry.name === 'pet_config.json' && fs.existsSync(destPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 命令行运行入口
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--check') || args.includes('-c')) {
    checkUpdate().then(res => {
      console.log(JSON.stringify(res, null, 2));
    }).catch(err => {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    });
  } else if (args.includes('--upgrade') || args.includes('-u')) {
    applyUpdate().then(res => {
      console.log(JSON.stringify(res, null, 2));
    }).catch(err => {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    });
  } else {
    checkUpdate().then(res => {
      console.log('==============================================');
      console.log('🌟 Gemini 星星猫娘桌宠 · 版本更新检查');
      console.log('==============================================');
      console.log(`当前本地版本: v${res.currentVersion} ${res.currentCommit ? `(${res.currentCommit})` : ''}`);
      console.log(`GitHub 最新版: v${res.latestVersion} ${res.latestCommit ? `(${res.latestCommit})` : ''}`);
      if (res.hasUpdate) {
        console.log(`\n🎉 发现新更新！`);
        console.log(`更新说明: ${res.releaseNotes}`);
        console.log(`\n执行 node scripts/update_pet.js --upgrade 可一键完成更新配置！`);
      } else {
        console.log('\n✨ 当前已是最新版本，无需更新！');
      }
    });
  }
}

module.exports = {
  checkUpdate,
  applyUpdate
};
