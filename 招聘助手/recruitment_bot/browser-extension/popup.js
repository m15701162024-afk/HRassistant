const elements = {
  safetyStatus: document.getElementById('safetyStatus'),
  accountName: document.getElementById('accountName'),
  accountNameInput: document.getElementById('accountNameInput'),
  backendStatus: document.getElementById('backendStatus'),
  totalResumes: document.getElementById('totalResumes'),
  todayResumes: document.getElementById('todayResumes'),
  recommendedCount: document.getElementById('recommendedCount'),
  btnOpenWebAdmin: document.getElementById('btnOpenWebAdmin'),
  btnSaveAccount: document.getElementById('btnSaveAccount'),
  logBody: document.getElementById('logBody'),
  logCount: document.getElementById('logCount'),
};

const DEFAULT_SETTINGS = {
  backendUrl: 'http://127.0.0.1:8787',
  accountName: '',
  accountPlatform: 'BOSS直聘',
  dailyLimit: 20,
};

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function escapeHTML(text) {
  return String(text || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
}

function getLogs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['logs'], (result) => resolve(result.logs || []));
  });
}

function getDashboard() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getDashboard' }, (response) => resolve(response || {}));
  });
}

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    elements.logBody.innerHTML = '<div class="empty-state">暂无日志记录</div>';
    elements.logCount.textContent = '0 条';
    return;
  }
  const displayLogs = logs.slice(0, 20);
  elements.logBody.innerHTML = displayLogs.map(log => `
    <div class="log-entry">
      <span class="log-time">${escapeHTML(formatTime(new Date(log.time)))}</span>
      <span>${escapeHTML(log.message)}</span>
    </div>
  `).join('');
  elements.logCount.textContent = `${logs.length} 条`;
}

async function checkBackend(backendUrl) {
  try {
    const base = (backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, '');
    const response = await fetch(`${base}/api/health`);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) throw new Error('bad backend');
    elements.backendStatus.textContent = '已连接';
    elements.backendStatus.classList.add('ok');
  } catch (err) {
    elements.backendStatus.textContent = '未连接';
    elements.backendStatus.classList.remove('ok');
  }
}

async function updatePopup() {
  const [settings, dashboard, logs] = await Promise.all([
    getSettings(),
    getDashboard(),
    getLogs(),
  ]);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings, ...(dashboard.settings || {}) };
  const safetyState = dashboard.safetyState || {};
  const detectedAccount = dashboard.detectedAccount || {};

  elements.safetyStatus.textContent = safetyState.isDegraded ? '已降级' : '正常';
  elements.safetyStatus.classList.toggle('ok', !safetyState.isDegraded);
  elements.accountName.textContent = mergedSettings.accountName || detectedAccount.name || '打开招聘页面后自动识别';
  elements.accountNameInput.value = mergedSettings.accountName || '';
  elements.totalResumes.textContent = dashboard.totalCount ?? 0;
  elements.todayResumes.textContent = dashboard.todayCount ?? 0;
  elements.recommendedCount.textContent = dashboard.recommendedCount ?? 0;
  renderLogs(logs);
  await checkBackend(mergedSettings.backendUrl);
}

elements.btnOpenWebAdmin.addEventListener('click', async () => {
  const settings = await getSettings();
  const url = (settings.backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, '');
  chrome.tabs.create({ url });
});

elements.btnSaveAccount.addEventListener('click', async () => {
  const accountName = elements.accountNameInput.value.trim();
  chrome.runtime.sendMessage({
    action: 'manualAccountUpdated',
    accountName,
    accountPlatform: 'BOSS直聘',
  }, () => updatePopup());
});

chrome.runtime.onMessage.addListener((message) => {
  if ([
    'resumeReceived',
    'candidateRecommended',
    'candidateBrowsed',
    'resumeScraped',
    'resumeActionExecuted',
    'log',
    'detectedAccountUpdated',
  ].includes(message.action)) {
    updatePopup();
  }
});

updatePopup();
