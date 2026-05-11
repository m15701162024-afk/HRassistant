/**
 * popup.js - 招聘助手浏览器插件弹窗控制脚本
 * 功能：一键浏览候选人、自动处理简历动作、钉钉推送配置、推荐结果查看
 */

const elements = {
  safetyStatus: document.getElementById('safetyStatus'),
  pageStatus: document.getElementById('pageStatus'),
  limitStatus: document.getElementById('limitStatus'),
  totalResumes: document.getElementById('totalResumes'),
  todayResumes: document.getElementById('todayResumes'),
  recommendedCount: document.getElementById('recommendedCount'),
  latestRecommendation: document.getElementById('latestRecommendation'),
  sourceSummary: document.getElementById('sourceSummary'),
  qualitySummary: document.getElementById('qualitySummary'),
  dingtalkStatus: document.getElementById('dingtalkStatus'),
  dingtalkWebhook: document.getElementById('dingtalkWebhook'),
  backendUrl: document.getElementById('backendUrl'),
  dingtalkSecret: document.getElementById('dingtalkSecret'),
  accountName: document.getElementById('accountName'),
  scheduledPushTime: document.getElementById('scheduledPushTime'),
  btnSaveDingTalk: document.getElementById('btnSaveDingTalk'),
  btnTestDingTalk: document.getElementById('btnTestDingTalk'),
  btnToggleSchedule: document.getElementById('btnToggleSchedule'),
  btnPushSummaryNow: document.getElementById('btnPushSummaryNow'),
  agentQuestion: document.getElementById('agentQuestion'),
  agentAnswer: document.getElementById('agentAnswer'),
  btnAskAgent: document.getElementById('btnAskAgent'),
  historyStorageView: document.getElementById('historyStorageView'),
  btnBrowseAndRun: document.getElementById('btnBrowseAndRun'),
  btnExportReports: document.getElementById('btnExportReports'),
  btnResetSafety: document.getElementById('btnResetSafety'),
  btnOpenBoss: document.getElementById('btnOpenBoss'),
  btnClearData: document.getElementById('btnClearData'),
  logBody: document.getElementById('logBody'),
  logCount: document.getElementById('logCount'),
};

const DEFAULT_SETTINGS = {
  autoAccept: true,
  autoRequestResume: true,
  autoBrowseProfiles: false,
  autoScrape: true,
  autoSync: true,
  dingtalkEnabled: false,
  dingtalkWebhook: '',
  dingtalkSecret: '',
  backendUrl: 'http://127.0.0.1:8787',
  accountName: '',
  accountPlatform: 'BOSS直聘',
  scheduledPushEnabled: false,
  scheduledPushTime: '10:00',
  scheduledPushLastDate: '',
  syncInterval: 5,
  acceptDelay: 18000,
  delayVariance: 9000,
  browseProbability: 0.55,
  dailyLimit: 20,
  hourlyLimit: 6,
  maxCandidatesPerRun: 5,
  candidateDwellMin: 12000,
  candidateDwellMax: 30000,
  actionDwellMin: 8000,
  actionDwellMax: 18000,
  requestDelayMin: 5000,
  requestDelayMax: 15000,
  detailDwellMin: 10000,
  detailDwellMax: 30000,
  behaviorPolicyEnabled: true,
  scrollMode: 'mixed',
  interactionModes: {
    manualPage: 40,
    detailClick: 35,
    filterReview: 25,
  },
  searchKeywordPool: [],
  longBreakEvery: 3,
  longBreakMin: 60000,
  longBreakMax: 150000,
  scrollBeforeClick: true,
  safeMode: true,
};

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
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

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
}

async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings }, resolve);
  });
}

async function getResumes() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['resumes'], (result) => resolve(result.resumes || []));
  });
}

async function getLogs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['logs'], (result) => resolve(result.logs || []));
  });
}

async function getRecommendedCandidates() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['recommendedCandidates'], (result) => {
      resolve(result.recommendedCandidates || []);
    });
  });
}

async function getCandidateReports() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['candidateReports'], (result) => {
      resolve(result.candidateReports || []);
    });
  });
}

async function addLog(message, type = 'info') {
  const logs = await getLogs();
  logs.unshift({ time: new Date().toISOString(), message, type });
  if (logs.length > 200) logs.length = 200;
  await new Promise((resolve) => chrome.storage.local.set({ logs }, resolve));
  renderLogs(logs);
}

async function getDashboard() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getDashboard' }, (response) => resolve(response || {}));
  });
}

function renderSafetyStatus(dashboard = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(dashboard.settings || {}) };
  const safetyState = dashboard.safetyState || {};
  const operationCount = dashboard.operationCount || {};
  const todayCount = operationCount.today || 0;

  elements.safetyStatus.textContent = safetyState.isDegraded ? '已降级' : '正常';
  elements.safetyStatus.classList.toggle('active', !safetyState.isDegraded);
  elements.safetyStatus.classList.toggle('inactive', safetyState.isDegraded);
  elements.limitStatus.textContent = `${todayCount} / ${settings.dailyLimit}`;
}

async function updateStats() {
  const dashboard = await getDashboard();
  const resumes = await getResumes();
  const today = formatDate(new Date());
  const todayCount = dashboard.todayCount ?? resumes.filter(item => item.receivedDate === today).length;
  const qualityScores = resumes.map(item => Number(item.qualityScore || 0)).filter(score => score > 0);
  const averageQuality = qualityScores.length
    ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length)
    : 0;
  const topSource = Object.entries(dashboard.sources || {}).sort((a, b) => b[1] - a[1])[0];
  const settings = { ...DEFAULT_SETTINGS, ...(dashboard.settings || {}) };

  elements.totalResumes.textContent = dashboard.totalCount ?? resumes.length;
  elements.todayResumes.textContent = todayCount;
  elements.recommendedCount.textContent = dashboard.recommendedCount ?? 0;
  elements.sourceSummary.textContent = topSource ? `${topSource[0]} ${topSource[1]}份` : '暂无来源';
  elements.qualitySummary.textContent = `完整度 ${averageQuality}%`;
  elements.latestRecommendation.textContent = dashboard.latestRecommendation
    ? `${dashboard.latestRecommendation.name} ${dashboard.latestRecommendation.score}%`
    : '暂无推荐';
  elements.accountName.value = dashboard.detectedAccount?.name || settings.accountName || '';
  elements.dingtalkStatus.textContent = settings.dingtalkEnabled && settings.dingtalkWebhook ? '已配置' : '未配置';
  elements.dingtalkStatus.classList.toggle('active', Boolean(settings.dingtalkEnabled && settings.dingtalkWebhook));
  elements.dingtalkStatus.classList.toggle('inactive', !(settings.dingtalkEnabled && settings.dingtalkWebhook));
  elements.btnToggleSchedule.textContent = settings.scheduledPushEnabled ? '关闭定时推送' : '开启定时推送';
  renderSafetyStatus(dashboard);
  await renderHistoryStorage();
}

async function renderHistoryStorage() {
  const resumes = await getResumes();
  const recommended = await getRecommendedCandidates();
  const reports = await getCandidateReports();
  const latest = recommended.slice(0, 5).map(item => (
    `- ${item.name || '未识别'}｜${item.role || '待确认'}｜${item.score || 0}%｜${item.source || item.accountPlatform || 'BOSS直聘'}｜${item.accountName || '账号未识别'}`
  ));
  elements.historyStorageView.textContent = [
    `候选人历史：${resumes.length} 条`,
    `推荐历史：${recommended.length} 条`,
    `报告历史：${reports.length} 条`,
    '',
    '最近推荐：',
    ...(latest.length ? latest : ['- 暂无推荐记录']),
  ].join('\n');
}

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    elements.logBody.innerHTML = '<div class="empty-state">暂无日志记录</div>';
    elements.logCount.textContent = '0 条';
    return;
  }

  const displayLogs = logs.slice(0, 30);
  elements.logBody.innerHTML = displayLogs.map(log => {
    const timeStr = escapeHTML(formatTime(new Date(log.time)));
    const type = escapeHTML(log.type);
    const message = escapeHTML(log.message);
    return `<div class="log-entry">
      <span class="log-time">${timeStr}</span>
      <span class="log-msg ${type}">${message}</span>
    </div>`;
  }).join('');
  elements.logCount.textContent = `${logs.length} 条`;
}

async function notifyBackgroundSettings(settings) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'settingsUpdated', settings }, () => resolve());
  });
}

function notifyContentScript(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
    }
  });
}

async function sendToTab(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function updatePageStatus() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('zhipin.com')) {
    elements.pageStatus.textContent = '非BOSS页面';
    elements.pageStatus.classList.remove('active');
    elements.pageStatus.classList.add('inactive');
    return;
  }

  try {
    const response = await sendToTab(tab, { action: 'getSafetyStatus' });
    const cardCount = response?.page?.cardCount ?? 0;
    const browseCount = response?.page?.browseCount ?? 0;
    const actionCount = response?.page?.actionCount ?? 0;
    elements.pageStatus.textContent = `卡片 ${cardCount} / 可浏览 ${browseCount} / 动作 ${actionCount}`;
    elements.pageStatus.classList.add('active');
    elements.pageStatus.classList.remove('inactive');
    renderSafetyStatus(response || {});
  } catch (err) {
    elements.pageStatus.textContent = '需刷新页面';
    elements.pageStatus.classList.remove('active');
    elements.pageStatus.classList.add('inactive');
  }
}

async function initSettingsForm() {
  const settings = await getSettings();
  elements.dingtalkWebhook.value = settings.dingtalkWebhook || '';
  elements.backendUrl.value = settings.backendUrl || 'http://127.0.0.1:8787';
  elements.dingtalkSecret.value = settings.dingtalkSecret || '';
  elements.scheduledPushTime.value = settings.scheduledPushTime || '10:00';
}

elements.btnSaveDingTalk.addEventListener('click', async () => {
  const settings = await getSettings();
  settings.dingtalkWebhook = elements.dingtalkWebhook.value.trim();
  settings.backendUrl = elements.backendUrl.value.trim() || 'http://127.0.0.1:8787';
  settings.dingtalkSecret = elements.dingtalkSecret.value.trim();
  settings.accountName = elements.accountName.value.trim();
  settings.accountPlatform = 'BOSS直聘';
  settings.scheduledPushTime = elements.scheduledPushTime.value || '10:00';
  settings.dingtalkEnabled = Boolean(settings.dingtalkWebhook);
  settings.autoAccept = true;
  settings.autoRequestResume = true;
  settings.autoScrape = true;
  settings.autoSync = true;
  await saveSettings(settings);
  await notifyBackgroundSettings(settings);
  notifyContentScript({ action: 'settingsChanged', settings });
  addLog(settings.dingtalkEnabled ? '钉钉连接配置已保存' : '已清空钉钉连接配置', 'success');
  await updateStats();
});

elements.btnTestDingTalk.addEventListener('click', async () => {
  const settings = await getSettings();
  settings.dingtalkWebhook = elements.dingtalkWebhook.value.trim();
  settings.backendUrl = elements.backendUrl.value.trim() || 'http://127.0.0.1:8787';
  settings.dingtalkSecret = elements.dingtalkSecret.value.trim();
  settings.dingtalkEnabled = Boolean(settings.dingtalkWebhook);
  await saveSettings(settings);
  await notifyBackgroundSettings(settings);

  if (!settings.dingtalkEnabled) {
    addLog('请先填写钉钉机器人 Webhook', 'error');
    return;
  }

  chrome.runtime.sendMessage({ action: 'testDingTalk' }, async (response) => {
    if (response?.success) {
      addLog('钉钉测试消息已发送', 'success');
    } else {
      addLog(`钉钉测试失败: ${response?.message || '未知错误'}`, 'error');
    }
    await updateStats();
  });
});

elements.btnToggleSchedule.addEventListener('click', async () => {
  const settings = await getSettings();
  settings.dingtalkWebhook = elements.dingtalkWebhook.value.trim();
  settings.backendUrl = elements.backendUrl.value.trim() || 'http://127.0.0.1:8787';
  settings.dingtalkSecret = elements.dingtalkSecret.value.trim();
  settings.accountName = elements.accountName.value.trim();
  settings.scheduledPushTime = elements.scheduledPushTime.value || '10:00';
  settings.dingtalkEnabled = Boolean(settings.dingtalkWebhook);

  if (!settings.dingtalkEnabled) {
    addLog('请先配置钉钉 Webhook 再开启定时推送', 'error');
    return;
  }

  settings.scheduledPushEnabled = !settings.scheduledPushEnabled;
  await saveSettings(settings);
  await notifyBackgroundSettings(settings);
  addLog(settings.scheduledPushEnabled ? `已开启每日 ${settings.scheduledPushTime} 定时推送` : '已关闭定时推送', 'success');
  await updateStats();
});

elements.btnPushSummaryNow.addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'pushScheduledSummaryNow' }, async (response) => {
    if (response?.success) {
      addLog('历史汇总已推送到钉钉', 'success');
    } else {
      addLog(`汇总推送失败: ${response?.message || '未知错误'}`, 'error');
    }
    await updateStats();
  });
});

elements.btnAskAgent.addEventListener('click', async () => {
  const question = elements.agentQuestion.value.trim();
  if (!question) {
    addLog('请输入要查询的问题', 'error');
    return;
  }
  chrome.runtime.sendMessage({ action: 'answerHistoryQuestion', question }, (response) => {
    if (response?.success) {
      elements.agentAnswer.textContent = response.answer;
      addLog('Agent 已根据历史数据回答', 'success');
    } else {
      elements.agentAnswer.textContent = response?.message || '问答失败';
      addLog(`Agent 问答失败: ${response?.message || '未知错误'}`, 'error');
    }
  });
});

elements.btnBrowseAndRun.addEventListener('click', async () => {
  const confirmed = confirm(
    '将自动浏览当前页面候选人，并根据沟通界面判断执行“索要简历”或“接收简历”。\n\n' +
    '请确认当前页面是筛选好的候选人列表。'
  );
  if (!confirmed) return;

  addLog('正在浏览候选人并自动处理简历动作...', 'info');
  elements.btnBrowseAndRun.disabled = true;
  elements.btnBrowseAndRun.textContent = '处理中...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('zhipin.com')) {
      addLog('请先打开BOSS直聘页面', 'error');
      return;
    }

    const settings = await getSettings();
    settings.autoAccept = true;
    settings.autoRequestResume = true;
    settings.autoScrape = true;
    settings.autoSync = true;
    await saveSettings(settings);
    notifyContentScript({ action: 'settingsChanged', settings });

    const response = await sendToTab(tab, {
      action: 'browseCandidatesAndRunActions',
      maxCandidates: 10,
    });
    if (response?.success) {
      addLog(`处理完成，浏览 ${response.browsed}/${response.total} 人，执行动作 ${response.actionExecuted} 个`, response.actionExecuted ? 'success' : 'info');
      if (response.blockedBySafety) {
        addLog('已触发安全限速，后续处理暂停', 'error');
      }
      await updatePageStatus();
      await updateStats();
    } else {
      addLog(response?.message || '处理失败，请刷新页面后重试', 'error');
    }
  } catch (err) {
    addLog(`处理出错: ${err.message}`, 'error');
  } finally {
    elements.btnBrowseAndRun.disabled = false;
    elements.btnBrowseAndRun.textContent = '开始浏览并处理候选人';
  }
});

elements.btnExportReports.addEventListener('click', async () => {
  const reports = await getCandidateReports();
  const recommended = await getRecommendedCandidates();
  if (reports.length === 0) {
    addLog('暂无推荐报告可导出', 'error');
    return;
  }

  const summaryRows = recommended.map((item, index) => (
    `| ${index + 1} | ${item.name || ''} | ${item.role || ''} | ${item.education || ''} | ${item.experience || ''} | ${item.score || 0}% | ${item.recommendation || ''} | ${item.source || item.accountPlatform || 'BOSS直聘'} | ${item.accountName || ''} | 待联系 | ${item.nextStep || ''} |`
  ));
  const content = [
    `# ${formatDate(new Date())}_候选人推荐汇总`,
    '',
    '## 汇总表',
    '| 序号 | 姓名 | 申请职位 | 学历 | 工作年限 | 匹配度 | 推荐意见 | 数据来源 | 账号信息 | 处理状态 | 备注 |',
    '|------|------|----------|------|----------|--------|----------|----------|----------|----------|------|',
    ...summaryRows,
    '',
    '---',
    '',
    ...reports.map(item => item.report),
  ].join('\n');

  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${formatDate(new Date())}_候选人推荐汇总.md`;
  a.click();
  URL.revokeObjectURL(url);
  addLog(`已导出 ${reports.length} 份推荐报告`, 'success');
});

elements.btnResetSafety.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('zhipin.com')) {
    addLog('请先打开BOSS直聘页面再恢复安全状态', 'error');
    return;
  }

  try {
    const response = await sendToTab(tab, { action: 'resetSafety' });
    if (response?.success) {
      addLog('安全状态已恢复，计数器已重置', 'success');
      await updatePageStatus();
      await updateStats();
    } else {
      addLog('恢复失败，请刷新页面后重试', 'error');
    }
  } catch (err) {
    addLog(`恢复失败: ${err.message}`, 'error');
  }
});

elements.btnOpenBoss.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.zhipin.com/' });
  addLog('已打开BOSS直聘', 'info');
});

elements.btnClearData.addEventListener('click', async () => {
  if (confirm('确定要清除运行日志吗？候选人、推荐报告和历史数据会继续保留。')) {
    await chrome.storage.local.remove(['logs']);
    renderLogs([]);
    addLog('已清除运行日志，历史候选人数据已保留', 'info');
    await updateStats();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'resumeReceived') {
    addLog(`收到新简历: ${message.name} - ${message.role}`, 'success');
    updateStats();
  } else if (message.action === 'candidateRecommended') {
    addLog(`已推送推荐候选人: ${message.name}｜${message.role}｜${message.score}%`, 'success');
    updateStats();
  } else if (message.action === 'candidateBrowsed') {
    addLog(`已浏览候选人: ${message.name}`, 'info');
  } else if (message.action === 'resumeScraped') {
    addLog(`抓取简历: ${message.name} - ${message.role}`, 'info');
  } else if (message.action === 'resumeActionExecuted') {
    addLog(`已执行${message.actionLabel}: ${message.name}`, 'success');
  } else if (message.action === 'log') {
    addLog(message.message, message.type || 'info');
  }
});

async function init() {
  await initSettingsForm();
  await updatePageStatus();
  await updateStats();
  renderLogs(await getLogs());
}

init();
