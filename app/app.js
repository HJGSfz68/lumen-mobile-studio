const $ = id => document.getElementById(id);

const state = {
  dark: false,
  fullscreen: false,
  externalLinks: false,
  iconDataUrl: null,
};

const toggles = [
  ['swDark', 'dark'],
  ['swFull', 'fullscreen'],
  ['swExt', 'externalLinks'],
];
toggles.forEach(([id, key]) => {
  $(id).addEventListener('click', () => {
    state[key] = !state[key];
    $(id).classList.toggle('on', state[key]);
    $(id).setAttribute('aria-checked', String(state[key]));
  });
});

$('pickIcon').addEventListener('click', () => $('iconInput').click());
$('iconInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.iconDataUrl = reader.result;
    $('iconPreview').innerHTML = `<img src="${state.iconDataUrl}" alt="icon">`;
  };
  reader.readAsDataURL(file);
});

function validUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

function slugPkg(pkg) {
  return pkg.trim().toLowerCase().replace(/[^a-z0-9.]/g, '').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');
}

function buildConfig() {
  return {
    appName: $('appName').value.trim() || 'My App',
    siteUrl: $('siteUrl').value.trim(),
    packageName: slugPkg($('pkg').value) || 'app.lumen.webapp',
    versionName: $('verName').value.trim() || '1.0.0',
    versionCode: parseInt($('verCode').value, 10) || 1,
    ...state,
    createdAt: new Date().toISOString(),
  };
}

const GH_TOKEN_KEY = 'lumen_gh_token';
const GH_REPO_KEY = 'lumen_gh_repo';

const isPages = location.hostname.endsWith('.github.io');

function initBackendMode() {
  if (isPages) {
    $('repoField').hidden = false;
    $('tokenField').hidden = false;
    $('modeHint').textContent = '云端编译模式：配置将提交到 GitHub Actions 构建（约 2-4 分钟）';
    $('ghToken').value = localStorage.getItem(GH_TOKEN_KEY) || '';
    $('ghRepo').value = localStorage.getItem(GH_REPO_KEY) || location.pathname.split('/')[1] || '';
  }
}

initBackendMode();

function ghApiError(status, data) {
  const msg = (data && (data.message || (data.errors && data.errors[0] && data.errors[0].message))) || `HTTP ${status}`;
  return new Error(msg);
}

async function generateViaActions(payload, btn) {
  const repo = $('ghRepo').value.trim().replace(/^https:\/\/github\.com\//, '');
  const token = $('ghToken').value.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('请填写正确的仓库（用户名/仓库名）');
  if (!token) throw new Error('请填写 GitHub Token');
  localStorage.setItem(GH_TOKEN_KEY, token);
  localStorage.setItem(GH_REPO_KEY, repo);

  btn.textContent = '正在提交构建任务…';
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  let resp = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST', headers,
    body: JSON.stringify({ event_type: 'build-apk', client_payload: payload }),
  });
  if (resp.status === 204) {
    // repository_dispatch 需要 contents:write 权限；若失败尝试 workflow_dispatch
  } else {
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 422) {
      resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/build-apk.yml/dispatches`, {
        method: 'POST', headers,
        body: JSON.stringify({ ref: 'master', inputs: { config: JSON.stringify(payload) } }),
      });
      if (resp.status !== 204) {
        const d2 = await resp.json().catch(() => ({}));
        throw ghApiError(resp.status, d2);
      }
    } else {
      throw ghApiError(resp.status, data);
    }
  }

  btn.textContent = '排队编译中…';
  const started = Date.now();
  let runId = null;
  while (Date.now() - started < 600000) {
    await new Promise(r => setTimeout(r, 8000));
    const runsResp = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/build-apk.yml/runs?per_page=3`, { headers });
    const runs = await runsResp.json();
    const run = (runs.workflow_runs || []).find(r => new Date(r.created_at).getTime() > started - 5000);
    if (!run) continue;
    runId = run.id;
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error('Actions 构建失败，请到仓库 Actions 页查看日志');
      const relResp = await fetch(
        `https://api.github.com/repos/${repo}/releases/tags/build-${runId}`, { headers });
      const rel = await relResp.json();
      const asset = (rel.assets || []).find(a => a.name.endsWith('.apk'));
      if (asset) {
        return { downloadUrl: asset.browser_download_url, packageName: payload.packageName, sizeKb: Math.round(asset.size / 1024), releaseTag: `build-${runId}` };
      }
      throw new Error('构建成功但未找到 APK 产物');
    }
    btn.textContent = `云端编译中…（${Math.round((Date.now() - started) / 1000)}s）`;
  }
  throw new Error('编译超时（10 分钟），请稍后到仓库 Releases 页查看产物');
}

let lastDownloadUrl = null;
let lastPkgName = null;
let lastIsExternal = false;

$('generate').addEventListener('click', async () => {
  const cfg = buildConfig();
  if (!validUrl(cfg.siteUrl)) {
    $('result').hidden = false;
    $('resultText').textContent = '请输入有效的网站地址（以 http/https 开头）';
    $('resultText').style.color = '#f87171';
    return;
  }
  const btn = $('generate');
  btn.disabled = true;
  btn.textContent = '正在生成…';

  try {
    const payload = {
      appName: cfg.appName,
      siteUrl: cfg.siteUrl,
      packageName: cfg.packageName,
      versionName: cfg.versionName,
      versionCode: cfg.versionCode,
      dark: state.dark,
      fullscreen: state.fullscreen,
      externalLinks: state.externalLinks,
      iconData: state.iconDataUrl || '',
    };

    if (isPages) {
      const data = await generateViaActions(payload, btn);
      lastDownloadUrl = data.downloadUrl;
      lastPkgName = cfg;
      lastIsExternal = true;
      $('result').hidden = false;
      $('resultText').style.color = '';
      $('resultText').textContent = `生成成功 · ${data.packageName} · ${data.sizeKb} KB`;
      return;
    }

    const resp = await fetch('/api/generate-apk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.detail || data.error || '构建失败');
    }
    lastDownloadUrl = data.downloadUrl;
    lastPkgName = cfg;
    lastIsExternal = false;

    $('result').hidden = false;
    $('resultText').style.color = '';
    $('resultText').textContent = `生成成功 · ${data.packageName} · ${data.sizeKb} KB`;
  } catch (e) {
    $('result').hidden = false;
    $('resultText').style.color = '#f87171';
    $('resultText').textContent = `生成失败：${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '生成可安装 APK';
  }
});

$('install').addEventListener('click', () => {
  if (!lastDownloadUrl) return;
  const a = document.createElement('a');
  a.href = lastDownloadUrl;
  a.download = `${lastPkgName.packageName}.apk`;
  if (!lastIsExternal) a.target = '_self';
  else a.target = '_blank', a.rel = 'noopener';
  a.click();
});

$('share').addEventListener('click', async () => {
  if (!lastDownloadUrl) return;
  const cfg = lastPkgName;
  const shareData = {
    title: cfg.appName,
    text: lastIsExternal
      ? `${cfg.appName} APK 下载地址：${lastDownloadUrl}`
      : `${cfg.appName} APK 下载地址：${location.origin}${lastDownloadUrl}`,
  };
  if (navigator.share) {
    try { await navigator.share(shareData); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(shareData.text);
    $('resultText').textContent = 'APK 下载链接已复制到剪贴板';
  } catch {
    $('resultText').textContent = shareData.text;
  }
});
