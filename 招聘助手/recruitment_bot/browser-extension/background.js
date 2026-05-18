/**
 * background.js - 招聘助手浏览器插件 - 后台服务
 *
 * 功能：
 * 1. 管理插件生命周期
 * 2. 定时检查新简历
 * 3. 处理跨页面通信
 * 4. 管理通知
 */

const DEFAULT_SETTINGS = {
  autoAccept: false,
  autoRequestResume: false,
  autoBrowseProfiles: false,
  autoScrape: true,
  autoSync: true,
  dingtalkEnabled: false,
  dingtalkWebhook: '',
  dingtalkSecret: '',
  backendUrl: 'http://127.0.0.1:8787',
  accountName: '',
  accountPlatform: 'BOSS直聘',
  accountNameManual: false,
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
  workTimeEnabled: false,
  workStartTime: '09:00',
  workEndTime: '18:00',
  workDays: [1, 2, 3, 4, 5],
  scrollMode: 'mixed',
  interactionModes: {
    manualPage: 40,
    detailClick: 35,
    filterReview: 25,
  },
  searchKeywordPool: [],
  pageIntelligenceEnabled: true,
  pageIntelligenceUseScreenshot: false,
  longBreakEvery: 3,
  longBreakMin: 60000,
  longBreakMax: 150000,
  scrollBeforeClick: true,
  safeMode: true,
};

// ============================================================
// 插件安装/更新
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[招聘助手] 插件已安装/更新:', details.reason);

  const current = await chrome.storage.local.get([
    'settings',
    'resumes',
    'logs',
    'recommendedCandidates',
    'candidateReports',
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...(current.settings || {}) };
  await chrome.storage.local.set({
    settings,
    resumes: current.resumes || [],
    logs: current.logs || [],
    recommendedCandidates: current.recommendedCandidates || [],
    candidateReports: current.candidateReports || [],
  });

  await configureAlarm(settings.syncInterval);
  await updateBadge();

  if (details.reason === 'install') {
    chrome.tabs.create({
      url: 'https://www.zhipin.com/',
    });
  }
});

// ============================================================
// 定时任务 - 定期检查BOSS直聘页面
// ============================================================

configureAlarm(DEFAULT_SETTINGS.syncInterval);
chrome.alarms.create('scheduledSummaryPush', {
  periodInMinutes: 1,
});
chrome.alarms.create('syncBehaviorPolicy', {
  periodInMinutes: 10,
});
chrome.alarms.create('pollAutomationTasks', {
  periodInMinutes: 1,
});

async function configureAlarm(intervalMinutes = DEFAULT_SETTINGS.syncInterval) {
  const minutes = Math.max(1, Number(intervalMinutes) || DEFAULT_SETTINGS.syncInterval);
  await chrome.alarms.clear('checkNewResumes');
  chrome.alarms.create('checkNewResumes', {
    periodInMinutes: minutes,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkNewResumes') {
    checkBOSSPage();
  } else if (alarm.name === 'scheduledSummaryPush') {
    checkScheduledSummaryPush();
  } else if (alarm.name === 'syncBehaviorPolicy') {
    syncBehaviorPolicyFromBackend();
  } else if (alarm.name === 'pollAutomationTasks') {
    pollAutomationTasksFromBackend();
  }
});

async function checkBOSSPage() {
  try {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
    if (!settings.autoSync) return;

    // 查找已打开的BOSS直聘标签页
    const tabs = await chrome.tabs.query({
      url: ['https://www.zhipin.com/*', 'https://www.bosszhipin.com/*'],
    });

    if (tabs.length > 0) {
      // 通知 content script 执行检查
      for (const tab of tabs) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'checkNewResumes',
          });
          if (response?.savedCount > 0) {
            await updateBadge();
            showNotification(`发现并保存 ${response.savedCount} 份新简历`);
          }
        } catch (e) {
          // content script 可能未加载
        }
      }
    }
  } catch (err) {
    console.error('[招聘助手] 定时检查失败:', err);
  }
}

// ============================================================
// 标签页更新监听
// ============================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当BOSS直聘页面加载完成时
  if (changeInfo.status === 'complete' &&
      tab.url &&
      tab.url.includes('zhipin.com')) {
    console.log('[招聘助手] BOSS直聘页面已加载:', tab.url);

    // 注入 content script（如果尚未注入）
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    }).catch(() => {
      // 可能已经注入，忽略错误
    });
  }
});

// ============================================================
// 通知管理
// ============================================================

chrome.notifications.onClicked.addListener((notificationId) => {
  // 点击通知时打开对应页面
  chrome.tabs.query({ url: '*://www.zhipin.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url: 'https://www.zhipin.com/' });
    }
  });
});

function showNotification(text) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '招聘助手',
    message: text || '收到新简历',
  });
}

async function signDingTalkUrl(webhook, secret) {
  if (!secret) return webhook;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const bytes = new Uint8Array(signature);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  const sign = encodeURIComponent(btoa(binary));
  const separator = webhook.includes('?') ? '&' : '?';
  return `${webhook}${separator}timestamp=${timestamp}&sign=${sign}`;
}

async function sendDingTalkMarkdown({ title, text }) {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  if (!mergedSettings.dingtalkEnabled || !mergedSettings.dingtalkWebhook) {
    return { success: false, skipped: true, message: '钉钉未配置' };
  }

  const url = await signDingTalkUrl(
    mergedSettings.dingtalkWebhook.trim(),
    mergedSettings.dingtalkSecret.trim()
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        title: title || '招聘助手推荐候选人',
        text,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.errcode && body.errcode !== 0)) {
    throw new Error(body.errmsg || `钉钉推送失败: HTTP ${response.status}`);
  }
  return { success: true, body };
}

function buildDingTalkCandidateText(candidate = {}, report = '') {
  const title = `### 招聘助手推荐：${candidate.name || '候选人'}`;
  const summary = [
    title,
    '',
    `- 岗位：${candidate.role || '待确认'}`,
    `- 匹配度：${candidate.score || 0}%`,
    `- 推荐意见：${candidate.recommendation || '待定'}`,
    `- 下一步：${candidate.nextStep || '待跟进'}`,
    candidate.sourceUrl ? `- 来源：[打开候选人页面](${candidate.sourceUrl})` : '',
    '',
    '---',
    '',
  ].filter(Boolean).join('\n');
  return `${summary}${report || ''}`.slice(0, 18000);
}

async function syncToBackend(path, payload) {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  if (!mergedSettings.backendUrl) {
    return { success: false, skipped: true, message: '后端地址未配置' };
  }
  const base = mergedSettings.backendUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || `后端同步失败: HTTP ${response.status}`);
  }
  return body;
}

async function fetchFromBackend(path) {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  if (!mergedSettings.backendUrl) {
    return { success: false, skipped: true, message: '后端地址未配置' };
  }
  const base = mergedSettings.backendUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`后端接口返回非 JSON，请检查后端地址: ${base}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || `后端读取失败: HTTP ${response.status}`);
  }
  return body;
}

async function getWorkerId() {
  const current = await chrome.storage.local.get(['automationWorkerId']);
  if (current.automationWorkerId) return current.automationWorkerId;
  const workerId = `plugin-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  await chrome.storage.local.set({ automationWorkerId: workerId });
  return workerId;
}

async function reportAutomationTask(taskId, payload = {}) {
  if (!taskId) return { success: false, message: '缺少任务 ID' };
  return syncToBackend('/api/automation/tasks/update', {
    id: taskId,
    ...payload,
  });
}

async function pollAutomationTasksFromBackend() {
  try {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
    const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
    if (!mergedSettings.autoSync || !mergedSettings.backendUrl) return;
    const workerId = await getWorkerId();
    const claim = await syncToBackend('/api/automation/tasks/claim', {
      accountName: mergedSettings.accountName || '',
      workerId,
    });
    const task = claim.task;
    if (!task) return;
    const payload = task.payload || {};
    await reportAutomationTask(task.id, {
      status: 'running',
      workerId,
      result: { message: '插件已领取任务，正在打开 BOSS 沟通页执行' },
    });
    let result;
    try {
      if (task.task_type !== 'recruitmentWorkflow') {
        throw new Error(`不支持的任务类型：${task.task_type || '未知'}`);
      }
      const maxCandidates = Number(task.max_candidates || payload.maxCandidates || mergedSettings.maxCandidatesPerRun || 20);
      result = await startRecruitmentWorkflowInBossTab(maxCandidates);
      const success = result?.success !== false;
      await reportAutomationTask(task.id, {
        status: success ? 'completed' : 'failed',
        workerId,
        result,
        errorMessage: success ? '' : (result?.message || '插件执行失败'),
      });
      showNotification(success
        ? `远程任务已完成，处理 ${result?.processed ?? result?.savedCount ?? '-'} 位候选人`
        : `远程任务失败：${result?.message || '未知错误'}`);
    } catch (error) {
      await reportAutomationTask(task.id, {
        status: 'failed',
        workerId,
        result: result || {},
        errorMessage: error.message,
      });
      showNotification(`远程任务失败：${error.message}`);
    }
  } catch (err) {
    console.warn('[招聘助手] 远程任务轮询失败:', err);
  }
}

async function captureVisibleTabDataUrl(senderTab, enabled = false) {
  if (!enabled || !senderTab?.windowId) return '';
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(senderTab.windowId, {
      format: 'jpeg',
      quality: 55,
    });
    // 保持在默认 4MB JSON 限制内，过大的截图会改走文本 NLP。
    return dataUrl && dataUrl.length < 3_200_000 ? dataUrl : '';
  } catch (err) {
    console.warn('[招聘助手] 页面截图 OCR 捕获失败:', err.message);
    return '';
  }
}

async function extractPageIntelligence(payload = {}, sender = {}) {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  const screenshotDataUrl = await captureVisibleTabDataUrl(
    sender.tab,
    Boolean(mergedSettings.pageIntelligenceUseScreenshot && payload.includeScreenshot)
  );
  return syncToBackend('/api/page-intelligence/extract', {
    ...payload,
    screenshotDataUrl,
  });
}

async function syncBehaviorPolicyFromBackend() {
  try {
    const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
    const mergedBaseSettings = { ...DEFAULT_SETTINGS, ...settings };
    const accountName = String(mergedBaseSettings.accountName || '').trim();
    const policy = await fetchFromBackend(`/api/behavior-policy${accountName ? `?account=${encodeURIComponent(accountName)}` : ''}`);
    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      behaviorPolicyEnabled: Boolean(policy.behaviorPolicyEnabled),
      workTimeEnabled: Boolean(policy.workTimeEnabled),
      workStartTime: policy.workStartTime || DEFAULT_SETTINGS.workStartTime,
      workEndTime: policy.workEndTime || DEFAULT_SETTINGS.workEndTime,
      workDays: Array.isArray(policy.workDays) ? policy.workDays : DEFAULT_SETTINGS.workDays,
      requestDelayMin: Number(policy.requestDelayMin || DEFAULT_SETTINGS.requestDelayMin),
      requestDelayMax: Number(policy.requestDelayMax || DEFAULT_SETTINGS.requestDelayMax),
      acceptDelay: Math.round((Number(policy.requestDelayMin || 5000) + Number(policy.requestDelayMax || 15000)) / 2),
      delayVariance: Math.max(1000, Math.round((Number(policy.requestDelayMax || 15000) - Number(policy.requestDelayMin || 5000)) / 2)),
      candidateDwellMin: Number(policy.detailDwellMin || DEFAULT_SETTINGS.candidateDwellMin),
      candidateDwellMax: Number(policy.detailDwellMax || DEFAULT_SETTINGS.candidateDwellMax),
      actionDwellMin: Number(policy.actionDwellMin || DEFAULT_SETTINGS.actionDwellMin),
      actionDwellMax: Number(policy.actionDwellMax || DEFAULT_SETTINGS.actionDwellMax),
      scrollMode: policy.scrollMode || DEFAULT_SETTINGS.scrollMode,
      dailyLimit: Number(policy.dailyLimit || DEFAULT_SETTINGS.dailyLimit),
      hourlyLimit: Number(policy.hourlyLimit || DEFAULT_SETTINGS.hourlyLimit),
      maxCandidatesPerRun: Number(policy.maxCandidatesPerRun || DEFAULT_SETTINGS.maxCandidatesPerRun),
      browseProbability: Number(policy.browseProbability ?? DEFAULT_SETTINGS.browseProbability),
      longBreakEvery: Number(policy.longBreakEvery || DEFAULT_SETTINGS.longBreakEvery),
      longBreakMin: Number(policy.longBreakMin || DEFAULT_SETTINGS.longBreakMin),
      longBreakMax: Number(policy.longBreakMax || DEFAULT_SETTINGS.longBreakMax),
      interactionModes: policy.interactionModes || DEFAULT_SETTINGS.interactionModes,
      searchKeywordPool: policy.searchKeywordPool || [],
      pageIntelligenceEnabled: policy.pageIntelligenceEnabled !== false,
      pageIntelligenceUseScreenshot: Boolean(policy.pageIntelligenceUseScreenshot),
      saveRawResumeText: policy.saveRawResumeText !== false,
      maskSensitiveDisplay: policy.maskSensitiveDisplay !== false,
    };
    await chrome.storage.local.set({ settings: mergedSettings, behaviorPolicy: policy });
    const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://www.bosszhipin.com/*'] });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'settingsChanged', settings: mergedSettings }).catch(() => {});
    }
    return { success: true, policy };
  } catch (err) {
    console.warn('[招聘助手] 同步后端节奏策略失败:', err.message);
    return { success: false, message: err.message };
  }
}

function getLocalDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function getDateStringByOffset(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return getLocalDateString(date);
}

function getLocalTimeString(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

async function checkScheduledSummaryPush() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  if (!mergedSettings.scheduledPushEnabled) return;

  const today = getLocalDateString();
  const nowTime = getLocalTimeString();
  if (mergedSettings.scheduledPushLastDate === today) return;
  if (nowTime !== mergedSettings.scheduledPushTime) return;

  const yesterday = getDateStringByOffset(-1);
  const text = await buildHistorySummaryMarkdown({
    title: `${yesterday} 招聘助手候选人汇总`,
    dateScope: yesterday,
  });
  await sendDingTalkMarkdown({
    title: `${yesterday} 招聘助手候选人汇总`,
    text,
  });

  mergedSettings.scheduledPushLastDate = today;
  await chrome.storage.local.set({ settings: mergedSettings });
}

async function buildHistorySummaryMarkdown({ title = '招聘助手候选人汇总', includeAllHistory = true, dateScope = null } = {}) {
  const {
    resumes = [],
    recommendedCandidates = [],
    candidateReports = [],
    settings = DEFAULT_SETTINGS,
  } = await chrome.storage.local.get(['resumes', 'recommendedCandidates', 'candidateReports', 'settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  const scopedResumes = dateScope
    ? resumes.filter(item => item.receivedDate === dateScope)
    : includeAllHistory
    ? resumes
    : resumes.filter(item => item.receivedDate === getLocalDateString());
  const scopedRecommended = dateScope
    ? recommendedCandidates.filter(item => (item.pushedAt || '').startsWith(dateScope))
    : includeAllHistory
    ? recommendedCandidates
    : recommendedCandidates.filter(item => (item.pushedAt || '').startsWith(getLocalDateString()));

  const sourceCounts = scopedResumes.reduce((acc, item) => {
    const source = item.source || item.accountPlatform || '未知来源';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
  const sourceText = Object.entries(sourceCounts)
    .map(([source, count]) => `${source} ${count}份`)
    .join('，') || '暂无';

  const rows = scopedRecommended.slice(0, 20).map((item, index) => (
    `| ${index + 1} | ${item.name || ''} | ${item.role || ''} | ${item.score || 0}% | ${item.recommendation || ''} | ${item.source || item.accountPlatform || 'BOSS直聘'} | ${item.accountName || mergedSettings.accountName || '未配置'} | ${item.nextStep || ''} |`
  ));

  return [
    `### ${title}`,
    '',
    `- 账号：${mergedSettings.accountName || '未配置'}`,
    `- 数据来源：${sourceText}`,
    `- 简历总数：${scopedResumes.length}`,
    `- 推荐候选人：${scopedRecommended.length}`,
    `- 历史报告：${candidateReports.length}`,
    '',
    '| 序号 | 姓名 | 申请职位 | 匹配度 | 推荐意见 | 数据来源 | 账号信息 | 下一步 |',
    '|------|------|----------|--------|----------|----------|----------|--------|',
    ...(rows.length ? rows : ['| - | 暂无 | - | - | - | - | - | - |']),
  ].join('\n').slice(0, 18000);
}

async function answerHistoryQuestion(question = '') {
  const {
    resumes = [],
    recommendedCandidates = [],
    candidateReports = [],
    settings = DEFAULT_SETTINGS,
  } = await chrome.storage.local.get(['resumes', 'recommendedCandidates', 'candidateReports', 'settings']);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  const q = question.trim();

  if (!q) {
    return '请告诉我你想查询什么，例如：今天推荐了谁？React候选人有哪些？匹配度最高的是谁？';
  }

  const today = getLocalDateString();
  const dataScope = /今天|今日/.test(q)
    ? resumes.filter(item => item.receivedDate === today)
    : resumes;
  const recommendedScope = /今天|今日/.test(q)
    ? recommendedCandidates.filter(item => (item.pushedAt || '').startsWith(today))
    : recommendedCandidates;

  if (/汇总|统计|多少|数量/.test(q)) {
    return [
      '### 招聘助手历史数据答复',
      '',
      `- 账号：${mergedSettings.accountName || '未配置'}`,
      `- 查询范围：${/今天|今日/.test(q) ? '今日' : '全部历史'}`,
      `- 简历数量：${dataScope.length}`,
      `- 推荐候选人：${recommendedScope.length}`,
      `- 报告数量：${candidateReports.length}`,
    ].join('\n');
  }

  const keywordMatch = q.match(/[A-Za-z0-9+#.一-龥]{2,}/g) || [];
  const stopWords = new Set(['今天', '今日', '候选人', '推荐', '简历', '哪些', '哪个', '有没有', '最高', '匹配度', '统计', '汇总']);
  const keywords = keywordMatch.filter(word => !stopWords.has(word));
  let matches = recommendedScope.length ? recommendedScope : dataScope;

  if (keywords.length) {
    matches = matches.filter(item => {
      const text = [
        item.name,
        item.role,
        item.education,
        item.experience,
        item.expectedSalary,
        item.summary,
        item.rawText,
        ...(item.strengths || []),
        ...(item.risks || []),
      ].filter(Boolean).join(' ');
      return keywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
    });
  }

  if (/最高|最好|最合适|排名/.test(q)) {
    matches = [...matches].sort((a, b) => (b.score || b.evaluation?.score || 0) - (a.score || a.evaluation?.score || 0));
  }

  const rows = matches.slice(0, 8).map((item, index) => (
    `${index + 1}. ${item.name || '未识别'}｜${item.role || '待确认岗位'}｜${item.score || item.evaluation?.score || 0}%｜${item.recommendation || item.evaluation?.recommendation || '待评估'}`
  ));

  return [
    '### 招聘助手历史数据答复',
    '',
    `问题：${q}`,
    '',
    rows.length ? rows.join('\n') : '没有找到匹配的候选人记录。',
  ].join('\n');
}

async function updateBadge() {
  const { resumes = [] } = await chrome.storage.local.get(['resumes']);
  const today = new Date().toISOString().split('T')[0];
  const todayCount = resumes.filter(item => item.receivedDate === today).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#00b38a' });
  await chrome.action.setBadgeText({ text: todayCount ? String(todayCount) : '' });
}

async function getDashboard() {
  const {
    resumes = [],
    settings = DEFAULT_SETTINGS,
    safetyState = {},
    operationCount = {},
    recommendedCandidates = [],
    detectedAccount = {},
  } = await chrome.storage.local.get(['resumes', 'settings', 'safetyState', 'operationCount', 'recommendedCandidates', 'detectedAccount']);
  const today = new Date().toISOString().split('T')[0];
  const todayCount = resumes.filter(item => item.receivedDate === today).length;
  const sources = resumes.reduce((acc, item) => {
    const source = item.source || '未知来源';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});

  return {
    totalCount: resumes.length,
    todayCount,
    sources,
    recommendedCount: recommendedCandidates.length,
    latestRecommendation: recommendedCandidates[0] || null,
    detectedAccount,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    safetyState,
    operationCount,
  };
}

// ============================================================
// 消息中转
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRecruitmentWorkflow') {
    startRecruitmentWorkflowInBossTab(message.maxCandidates || 20)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'showNotification') {
    showNotification(message.text);
    sendResponse({ success: true });
  }

  if (message.action === 'resumeReceived') {
    updateBadge();
  }

  if (message.action === 'pushCandidateRecommendation') {
    const candidate = message.candidate || {};
    sendDingTalkMarkdown({
      title: `推荐候选人：${candidate.name || '候选人'}`,
      text: buildDingTalkCandidateText(candidate, message.report || ''),
    }).catch(err => {
      console.error('[招聘助手] 钉钉推送失败:', err);
      showNotification(`钉钉推送失败：${err.message}`);
    });
    showNotification(
      `推荐候选人：${candidate.name || '候选人'}｜${candidate.role || '岗位待确认'}｜匹配度 ${candidate.score || 0}%`
    );
    sendResponse({ success: true });
  }

  if (message.action === 'syncCandidateToBackend') {
    syncToBackend('/api/candidates', message.candidate || {})
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'syncRecommendationToBackend') {
    syncToBackend('/api/recommendations', {
      candidate: message.candidate || {},
      report: message.report || '',
    }).then(sendResponse).catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'syncJobRequirementToBackend') {
    syncToBackend('/api/job-requirements', message.jobRequirement || {})
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'syncPendingJobRequirementToBackend') {
    syncToBackend('/api/job-requirements/pending', message.jobRequirement || {})
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'extractPageIntelligence') {
    extractPageIntelligence(message.payload || {}, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'getJobRequirementFromBackend') {
    const role = encodeURIComponent(message.role || '');
    const account = encodeURIComponent(message.accountName || '');
    fetchFromBackend(`/api/job-requirements?role=${role}&account=${account}`)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'scoreCandidateWithBackend') {
    syncToBackend('/api/candidates/score', { candidate: message.candidate || {} })
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message.action === 'detectedAccountUpdated') {
    const accountInfo = {
      ...(message.accountInfo || {}),
      name: String((message.accountInfo || {}).name || '').trim(),
      platform: (message.accountInfo || {}).platform || 'BOSS直聘',
    };
    chrome.storage.local.get(['settings'], ({ settings = DEFAULT_SETTINGS }) => {
      const manualName = String(settings.accountName || '').trim();
      if (settings.accountNameManual) {
        const mergedSettings = {
          ...DEFAULT_SETTINGS,
          ...settings,
          accountName: manualName,
          accountPlatform: accountInfo.platform || settings.accountPlatform || 'BOSS直聘',
          accountNameManual: Boolean(manualName),
        };
        chrome.storage.local.set({ settings: mergedSettings, detectedAccount: accountInfo });
        syncToBackend('/api/settings', {
          accountName: manualName,
          accountPlatform: mergedSettings.accountPlatform,
          accountNameManual: Boolean(manualName),
          detectedAccount: accountInfo,
        }).catch(() => {});
        sendResponse({ success: true, accountInfo, manualOverride: true });
        return;
      }
      const detectedName = accountInfo.name || String(settings.accountName || '').trim();
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...settings,
        accountName: detectedName,
        accountPlatform: accountInfo.platform || settings.accountPlatform || 'BOSS直聘',
        accountNameManual: false,
      };
      chrome.storage.local.set({ settings: mergedSettings, detectedAccount: accountInfo });
      syncToBackend('/api/settings', {
        accountName: mergedSettings.accountName,
        accountPlatform: mergedSettings.accountPlatform,
        accountNameManual: false,
        detectedAccount: accountInfo,
      }).catch(() => {});
      sendResponse({ success: true, accountInfo });
    });
    return true;
  }

  if (message.action === 'manualAccountUpdated') {
    const accountName = String(message.accountName || '').trim();
    const accountPlatform = String(message.accountPlatform || 'BOSS直聘').trim() || 'BOSS直聘';
    chrome.storage.local.get(['settings'], ({ settings = DEFAULT_SETTINGS }) => {
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...settings,
        accountName,
        accountPlatform,
        accountNameManual: Boolean(accountName),
      };
      chrome.storage.local.set({ settings: mergedSettings });
      syncToBackend('/api/settings', {
        accountName,
        accountPlatform,
        accountNameManual: Boolean(accountName),
      }).catch(() => {});
      sendResponse({ success: true, settings: mergedSettings });
    });
    return true;
  }

  if (message.action === 'testDingTalk') {
    sendDingTalkMarkdown({
      title: '招聘助手钉钉连接测试',
      text: '### 招聘助手钉钉连接测试\n\n如果你看到这条消息，说明招聘助手已成功连接钉钉机器人。',
    }).then(sendResponse).catch(err => {
      sendResponse({ success: false, message: err.message });
    });
    return true;
  }

  if (message.action === 'pushScheduledSummaryNow') {
    const yesterday = getDateStringByOffset(-1);
    buildHistorySummaryMarkdown({
      title: `${yesterday} 招聘助手候选人汇总`,
      dateScope: yesterday,
    }).then(text => sendDingTalkMarkdown({
      title: `${yesterday} 招聘助手候选人汇总`,
      text,
    })).then(sendResponse).catch(err => {
      sendResponse({ success: false, message: err.message });
    });
    return true;
  }

  if (message.action === 'answerHistoryQuestion') {
    answerHistoryQuestion(message.question || '').then(answer => {
      if (message.replyToDingTalk) {
        return sendDingTalkMarkdown({
          title: '招聘助手问答',
          text: answer,
        }).then(() => ({ success: true, answer }));
      }
      return { success: true, answer };
    }).then(sendResponse).catch(err => {
      sendResponse({ success: false, message: err.message });
    });
    return true;
  }

  if (message.action === 'settingsUpdated') {
    configureAlarm(message.settings?.syncInterval);
    syncBehaviorPolicyFromBackend();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'syncBehaviorPolicy') {
    syncBehaviorPolicyFromBackend().then(sendResponse);
    return true;
  }

  if (message.action === 'pollAutomationTasks') {
    pollAutomationTasksFromBackend().then(() => sendResponse({ success: true })).catch(err => {
      sendResponse({ success: false, message: err.message });
    });
    return true;
  }

  if (message.action === 'getDashboard') {
    getDashboard().then(sendResponse);
    return true;
  }

  if (message.action === 'refreshBadge') {
    updateBadge().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse(tabs[0] || null);
    });
    return true;
  }
});

async function startRecruitmentWorkflowInBossTab(maxCandidates = 20) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabs = [];
  if (activeTab?.url && /^https:\/\/www\.(boss)?zhipin\.com\//.test(activeTab.url)) {
    tabs.push(activeTab);
  }
  if (!tabs.length) {
    tabs.push(...await chrome.tabs.query({
      url: ['https://www.zhipin.com/*', 'https://www.bosszhipin.com/*'],
    }));
  }
  const tab = tabs[0];
  if (!tab?.id) throw new Error('请先打开 BOSS 直聘沟通页面');
  await chrome.tabs.update(tab.id, { active: true });
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, {
      action: 'startRecruitmentWorkflow',
      maxCandidates,
    }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, message: '招聘页面未加载插件脚本，请刷新 BOSS 页面后重试' });
        return;
      }
      resolve(response || { success: false, message: '任务未返回结果' });
    });
  });
}

console.log('[招聘助手] 后台服务已启动');
