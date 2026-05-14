const $ = (id) => document.getElementById(id);

const state = {
  settings: {},
  stats: {},
  candidates: [],
  recommendations: [],
  reports: [],
  jobRequirements: [],
  conversations: [],
  behaviorPolicy: {},
  filters: {
    q: '',
    source: '',
    account: '',
  },
};

const API_BASE_STORAGE_KEY = 'recruitmentAdminApiBase';
const DEFAULT_PUBLIC_BASE_URL = 'https://unconfuted-superbusily-ryan.ngrok-free.dev';
const LLM_PROVIDER_DEFAULTS = {
  openai: {
    apiBase: '',
    model: '',
  },
  claude: {
    apiBase: 'https://api.anthropic.com/v1',
    model: '',
  },
  qwen: {
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
  },
  aliyun: {
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
  },
  siliconflow: {
    apiBase: 'https://api.siliconflow.cn/v1',
    model: '',
  },
  deepseek: {
    apiBase: 'https://api.deepseek.com/v1',
    model: '',
  },
  custom: {
    apiBase: '',
    model: '',
  },
};

function defaultApiBase() {
  if (location.protocol === 'file:') return DEFAULT_PUBLIC_BASE_URL;
  return '';
}

function getApiBase() {
  return localStorage.getItem(API_BASE_STORAGE_KEY) || defaultApiBase();
}

function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isPlaceholderUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'hr.example.com' || host === 'example.com' || host.endsWith('.example.com');
  } catch (error) {
    return false;
  }
}

function apiUrl(path) {
  const base = normalizeApiBase(getApiBase());
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let data;
  if (contentType.includes('application/json')) {
    data = raw ? JSON.parse(raw) : {};
  } else {
    const preview = raw.replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`接口返回的不是 JSON。请确认后端服务已启动且后端地址正确。当前请求：${apiUrl(path)}；返回：${preview}`);
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.message || '请求失败');
  }
  return data;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function row(cells) {
  return `<tr>${cells.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
}

function cleanCandidateSnapshot(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  const stopMarkers = [
    '工作经历', '项目经历', '教育经历', '资格证书', '求职期望',
    '沟通记录', '聊天记录', '全部职位', '新招呼', '沟通中',
    '账号权益', '招聘规范', '职位管理', '推荐牛人', '批量',
  ];
  for (const marker of stopMarkers) {
    const index = text.indexOf(marker);
    if (index > 8) text = text.slice(0, index).trim();
  }
  return text.slice(0, 900);
}

function toast(message, type = 'success') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function queryString() {
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

async function loadHealth() {
  try {
    await api('/api/health');
    $('healthBadge').textContent = '服务正常';
    $('healthBadge').className = 'badge ok';
  } catch (err) {
    $('healthBadge').textContent = '服务异常';
    $('healthBadge').className = 'badge danger';
  }
}

function renderApiBase() {
  const base = normalizeApiBase(getApiBase());
  $('apiBaseInput').value = base || location.origin;
  $('apiBaseHint').textContent = base ? `使用 ${base}` : '使用当前域名';
}

async function loadSettings() {
  const settings = await api('/api/settings');
  state.settings = settings;
  $('dingtalkWebhook').value = settings.dingtalkWebhook || '';
  $('dingtalkSecret').value = settings.dingtalkSecret || '';
  $('dingtalkAppKey').value = '';
  $('dingtalkAppKey').placeholder = settings.dingtalkAppKeyConfigured ? '已配置，留空则保留' : '用于直接发送 Excel 文件';
  $('dingtalkAppSecret').value = '';
  $('dingtalkAppSecret').placeholder = settings.dingtalkAppSecretConfigured ? '已配置，留空则保留' : '用于上传 Excel 文件';
  $('dingtalkRobotCode').value = settings.dingtalkRobotCode || '';
  $('dingtalkOpenConversationId').value = settings.dingtalkOpenConversationId || '';
  $('dingtalkChatId').value = settings.dingtalkChatId || '';
  $('accountName').value = settings.accountName || settings.detectedAccount?.name || '';
  $('accountPlatform').value = settings.accountPlatform || settings.detectedAccount?.platform || 'BOSS直聘';
  if ($('jobAccountInput')) $('jobAccountInput').value = settings.accountName || settings.detectedAccount?.name || '';
  if ($('jobSourceInput') && !$('jobSourceInput').value) $('jobSourceInput').value = settings.accountPlatform || settings.detectedAccount?.platform || '手动录入';
  $('scheduledPushTime').value = settings.scheduledPushTime || '10:00';
  $('scheduledPushRangeMode').value = settings.scheduledPushRangeMode || 'yesterday';
  $('scheduledPushStart').value = settings.scheduledPushStart || '';
  $('scheduledPushEnd').value = settings.scheduledPushEnd || '';
  $('publicBaseUrl').value = isPlaceholderUrl(settings.publicBaseUrl) ? '' : (settings.publicBaseUrl || '');
  $('llmEnabled').value = settings.llmEnabled ? 'true' : 'false';
  $('llmProvider').value = settings.llmProvider || 'openai';
  $('llmApiBase').value = settings.llmApiBase || '';
  $('llmApiKey').value = '';
  $('llmApiKey').placeholder = settings.llmApiKeyConfigured ? '已配置，留空则保留原 Key' : '请输入 API Key';
  $('llmModel').value = settings.llmModel || '';
  $('llmTemperature').value = settings.llmTemperature ?? 0.2;
  $('llmMaxContextItems').value = settings.llmMaxContextItems ?? 80;
  $('llmMaxTokens').value = settings.llmMaxTokens ?? 1000;
  if ($('llmTimeoutSeconds')) $('llmTimeoutSeconds').value = settings.llmTimeoutSeconds ?? 90;
  $('llmStatus').textContent = settings.llmEnabled
    ? `已启用 ${settings.llmModel || '模型'}`
    : '未启用';
  $('llmStatus').className = settings.llmEnabled ? 'badge ok' : 'badge';
  $('toggleScheduleBtn').textContent = settings.scheduledPushEnabled ? '关闭定时推送' : '开启定时推送';
  $('scheduleStatus').textContent = settings.scheduledPushEnabled
    ? `已开启 ${settings.scheduledPushTime || '10:00'}｜${pushRangeLabel(settings.scheduledPushRangeMode)}`
    : '未开启';
  $('scheduleStatus').className = settings.scheduledPushEnabled ? 'badge ok' : 'badge';
  const callbackOrigin = normalizeApiBase(getApiBase()) || location.origin;
  $('callbackUrl').textContent = `${callbackOrigin}/api/dingtalk/callback`;
}

async function saveLlmConfig(showToast = true) {
  const payload = {
    llmEnabled: $('llmEnabled').value === 'true',
    llmProvider: $('llmProvider').value || 'openai',
    llmApiBase: $('llmApiBase').value.trim(),
    llmModel: $('llmModel').value.trim(),
    llmTemperature: Number($('llmTemperature').value || 0.2),
    llmMaxContextItems: Number($('llmMaxContextItems').value || 80),
    llmMaxTokens: Number($('llmMaxTokens').value || 1000),
    llmTimeoutSeconds: Number(($('llmTimeoutSeconds')?.value || 90)),
  };
  const apiKey = $('llmApiKey').value.trim();
  if (apiKey) payload.llmApiKey = apiKey;
  await api('/api/llm/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await loadSettings();
  if (showToast) toast('大模型配置已保存');
}

function applyLlmProviderPreset(force = false) {
  const provider = $('llmProvider').value || 'openai';
  const preset = LLM_PROVIDER_DEFAULTS[provider] || LLM_PROVIDER_DEFAULTS.openai;
  if (force || !$('llmApiBase').value.trim()) {
    $('llmApiBase').value = preset.apiBase;
  }
  if (force || !$('llmModel').value.trim()) {
    $('llmModel').value = preset.model;
  }
}

async function resetLlmConfig() {
  await api('/api/llm/config/reset', {
    method: 'POST',
    body: '{}',
  });
  await loadSettings();
  toast('大模型配置已清空');
}

async function testLlm() {
  await saveLlmConfig(false);
  $('answerBox').textContent = '正在测试大模型问答...';
  const result = await api('/api/agent/ask', {
    method: 'POST',
    body: JSON.stringify({ question: '请用一句话汇总当前招聘历史数据', sender: 'LLM 配置测试' }),
  });
  $('answerBox').textContent = `${result.answer}\n\n[Agent 模式] ${result.agent?.mode || 'unknown'}${result.agent?.model ? `｜${result.agent.model}` : ''}`;
  await loadConversations();
}

async function loadBehaviorPolicy() {
  const policy = await api('/api/behavior-policy');
  state.behaviorPolicy = policy;
  $('workTimeEnabled').value = policy.workTimeEnabled ? 'true' : 'false';
  $('workStartTime').value = policy.workStartTime || '09:00';
  $('workEndTime').value = policy.workEndTime || '18:00';
  $('workDays').value = (policy.workDays || [1, 2, 3, 4, 5]).join(',');
  $('requestDelayMin').value = policy.requestDelayMin ?? 5000;
  $('requestDelayMax').value = policy.requestDelayMax ?? 15000;
  $('detailDwellMin').value = policy.detailDwellMin ?? 10000;
  $('detailDwellMax').value = policy.detailDwellMax ?? 30000;
  $('scrollMode').value = policy.scrollMode || 'mixed';
  $('dailyLimit').value = policy.dailyLimit ?? 20;
  $('hourlyLimit').value = policy.hourlyLimit ?? 6;
  $('maxCandidatesPerRun').value = policy.maxCandidatesPerRun ?? 5;
  $('browseProbability').value = policy.browseProbability ?? 0.55;
  $('longBreakEvery').value = policy.longBreakEvery ?? 3;
  $('manualPageWeight').value = policy.interactionModes?.manualPage ?? 40;
  $('detailClickWeight').value = policy.interactionModes?.detailClick ?? 35;
  $('filterReviewWeight').value = policy.interactionModes?.filterReview ?? 25;
  $('searchKeywordPool').value = (policy.searchKeywordPool || []).join('\n');
  $('behaviorStatus').textContent = policy.behaviorPolicyEnabled ? '已开启' : '已关闭';
  $('behaviorStatus').className = policy.behaviorPolicyEnabled ? 'badge ok' : 'badge';
}

async function saveBehaviorPolicy() {
  const payload = {
    behaviorPolicyEnabled: true,
    workTimeEnabled: $('workTimeEnabled').value === 'true',
    workStartTime: $('workStartTime').value || '09:00',
    workEndTime: $('workEndTime').value || '18:00',
    workDays: $('workDays').value.split(/[,\s，]+/).map(item => Number(item)).filter(item => item >= 1 && item <= 7),
    requestDelayMin: Number($('requestDelayMin').value || 5000),
    requestDelayMax: Number($('requestDelayMax').value || 15000),
    detailDwellMin: Number($('detailDwellMin').value || 10000),
    detailDwellMax: Number($('detailDwellMax').value || 30000),
    scrollMode: $('scrollMode').value || 'mixed',
    dailyLimit: Number($('dailyLimit').value || 20),
    hourlyLimit: Number($('hourlyLimit').value || 6),
    maxCandidatesPerRun: Number($('maxCandidatesPerRun').value || 5),
    browseProbability: Number($('browseProbability').value || 0.55),
    longBreakEvery: Number($('longBreakEvery').value || 3),
    interactionModes: {
      manualPage: Number($('manualPageWeight').value || 40),
      detailClick: Number($('detailClickWeight').value || 35),
      filterReview: Number($('filterReviewWeight').value || 25),
    },
    searchKeywordPool: $('searchKeywordPool').value,
  };
  const result = await api('/api/behavior-policy', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  state.behaviorPolicy = result.behaviorPolicy || payload;
  await loadBehaviorPolicy();
  toast('操作节奏策略已保存');
}

async function saveSettings(showToast = true) {
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      dingtalkWebhook: $('dingtalkWebhook').value.trim(),
      dingtalkSecret: $('dingtalkSecret').value.trim(),
      dingtalkAppKey: $('dingtalkAppKey').value.trim(),
      dingtalkAppSecret: $('dingtalkAppSecret').value.trim(),
      dingtalkRobotCode: $('dingtalkRobotCode').value.trim(),
      dingtalkOpenConversationId: $('dingtalkOpenConversationId').value.trim(),
      dingtalkChatId: $('dingtalkChatId').value.trim(),
      accountName: $('accountName').value.trim(),
      accountPlatform: $('accountPlatform').value.trim() || 'BOSS直聘',
      accountNameManual: Boolean($('accountName').value.trim()),
      scheduledPushTime: $('scheduledPushTime').value || '10:00',
      scheduledPushRangeMode: $('scheduledPushRangeMode').value || 'yesterday',
      scheduledPushStart: $('scheduledPushStart').value,
      scheduledPushEnd: $('scheduledPushEnd').value,
      publicBaseUrl: $('publicBaseUrl').value.trim(),
    }),
  });
  await loadSettings();
  if (showToast) toast('配置已保存');
}

async function toggleSchedule() {
  const settings = await api('/api/settings');
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      dingtalkWebhook: $('dingtalkWebhook').value.trim(),
      dingtalkSecret: $('dingtalkSecret').value.trim(),
      dingtalkAppKey: $('dingtalkAppKey').value.trim(),
      dingtalkAppSecret: $('dingtalkAppSecret').value.trim(),
      dingtalkRobotCode: $('dingtalkRobotCode').value.trim(),
      dingtalkOpenConversationId: $('dingtalkOpenConversationId').value.trim(),
      dingtalkChatId: $('dingtalkChatId').value.trim(),
      accountName: $('accountName').value.trim(),
      accountPlatform: $('accountPlatform').value.trim() || 'BOSS直聘',
      accountNameManual: Boolean($('accountName').value.trim()),
      scheduledPushTime: $('scheduledPushTime').value || '10:00',
      scheduledPushRangeMode: $('scheduledPushRangeMode').value || 'yesterday',
      scheduledPushStart: $('scheduledPushStart').value,
      scheduledPushEnd: $('scheduledPushEnd').value,
      publicBaseUrl: $('publicBaseUrl').value.trim(),
      scheduledPushEnabled: !settings.scheduledPushEnabled,
    }),
  });
  await loadSettings();
  toast(settings.scheduledPushEnabled ? '已关闭定时推送' : '已开启定时推送');
}

async function loadData() {
  const qs = queryString();
  const suffix = qs ? `&${qs}` : '';
  const [stats, candidates, recommendations, reports, jobs] = await Promise.all([
    api('/api/stats'),
    api(`/api/candidates?limit=500${suffix}`),
    api(`/api/recommendations?limit=500${suffix}`),
    api(`/api/reports?limit=200${state.filters.q ? `&q=${encodeURIComponent(state.filters.q)}` : ''}`),
    api(`/api/job-requirements?limit=200${state.filters.q ? `&q=${encodeURIComponent(state.filters.q)}` : ''}`),
  ]);

  state.stats = stats;
  state.candidates = candidates.items || [];
  state.recommendations = recommendations.items || [];
  state.reports = reports.items || [];
  state.jobRequirements = jobs.items || [];

  renderStats();
  renderBreakdowns();
  renderTables();
  await loadConversations();
}

async function loadConversations() {
  const result = await api('/api/agent/conversations?limit=50');
  state.conversations = result.items || [];
  $('conversationCount').textContent = `${state.conversations.length} 条`;
  $('conversationList').innerHTML = state.conversations.slice(0, 20).map(item => `
    <article class="conversation">
      <div>
        <strong>${escapeHtml(item.channel || 'web')}｜${escapeHtml(item.sender || '未知')}</strong>
        <span>${escapeHtml(item.created_at || '')}</span>
      </div>
      <p>问：${escapeHtml(item.question || '')}</p>
      <pre>${escapeHtml(item.answer || '')}</pre>
    </article>
  `).join('') || '<p class="empty">暂无问答记录</p>';
}

function renderStats() {
  $('candidateCount').textContent = state.stats.totalCandidates || 0;
  $('todayCount').textContent = state.stats.todayCandidates || 0;
  $('yesterdayCount').textContent = state.stats.yesterdayCandidates || 0;
  $('recommendationCount').textContent = state.stats.recommendationCount || 0;
  $('averageScore').textContent = `${state.stats.averageScore || 0}%`;
  $('reportCount').textContent = state.stats.reportCount || 0;
}

function renderBreakdowns() {
  $('sourceBreakdown').innerHTML = renderBreakdown(state.stats.bySource || []);
  $('accountBreakdown').innerHTML = renderBreakdown(state.stats.byAccount || []);
  $('sourceCountHint').textContent = `${(state.stats.bySource || []).length} 类`;
  $('accountCountHint').textContent = `${(state.stats.byAccount || []).length} 个`;

  const top = state.stats.topRecommendations || [];
  $('topRecommendations').innerHTML = top.map(item => `
    <div class="top-item">
      <strong>${escapeHtml(item.name || '未识别')}</strong>
      <span>${escapeHtml(item.role || '待确认')}</span>
      <b>${escapeHtml(item.score || 0)}%</b>
      <em>${escapeHtml(item.recommendation || '待评估')}</em>
    </div>
  `).join('') || '<p class="empty">暂无推荐数据</p>';
}

function renderBreakdown(items) {
  const max = Math.max(1, ...items.map(item => Number(item.count || 0)));
  return items.slice(0, 8).map(item => {
    const percent = Math.round((Number(item.count || 0) / max) * 100);
    return `
      <div class="breakdown-row">
        <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <div><i style="width:${percent}%"></i></div>
        <b>${escapeHtml(item.count)}</b>
      </div>
    `;
  }).join('') || '<p class="empty">暂无数据</p>';
}

function renderTables() {
  $('candidateRows').innerHTML = state.candidates.map((item, index) => `
    <tr>
      <td>${escapeHtml(item.received_date)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.role)}</td>
      <td>${escapeHtml(item.education)}</td>
      <td>${escapeHtml(item.experience)}</td>
      <td>${escapeHtml(item.expected_salary)}</td>
      <td>${escapeHtml(`${item.score || 0}%`)}</td>
      <td>${escapeHtml(item.recommendation)}</td>
      <td>${escapeHtml(item.source)}</td>
      <td>${escapeHtml(item.account_name)}</td>
      <td><button class="secondary small" data-candidate-index="${index}">查看</button></td>
    </tr>
  `).join('') || row(['-', '暂无数据', '-', '-', '-', '-', '-', '-', '-', '-', '-']);

  $('recommendationRows').innerHTML = state.recommendations.map(item => row([
    item.name,
    item.role,
    `${item.score || 0}%`,
    item.recommendation,
    item.source,
    item.account_name,
    item.next_step,
    item.created_at,
  ])).join('') || row(['暂无数据', '-', '-', '-', '-', '-', '-', '-']);

  $('reportList').innerHTML = state.reports.slice(0, 80).map((item, index) => `
    <article class="report">
      <div>
        <h3>${escapeHtml(item.name || '候选人')} - ${escapeHtml(item.role || '待确认')}</h3>
        <p>${escapeHtml(item.created_at || '')}</p>
      </div>
      <button class="secondary small" data-report-index="${index}">查看报告</button>
    </article>
  `).join('') || '<p class="empty">暂无报告</p>';

  document.querySelectorAll('[data-report-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.reports[Number(button.dataset.reportIndex)];
      openDialog(`${item.name || '候选人'} - ${item.role || '待确认'}`, item.report || '');
    });
  });

  document.querySelectorAll('[data-candidate-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.candidates[Number(button.dataset.candidateIndex)];
      openDialog(`${item.name || '候选人'} - ${item.role || '待确认'}`, buildCandidateDetail(item));
    });
  });

  $('jobRequirementList').innerHTML = state.jobRequirements.slice(0, 100).map((item, index) => `
    <article class="report">
      <div>
        <h3>${escapeHtml(item.role || '未识别岗位')}</h3>
        <p>${escapeHtml(item.source || '')}｜${escapeHtml(item.account_name || '')}｜${escapeHtml(item.updated_at || '')}</p>
      </div>
      <button class="secondary small" data-job-index="${index}">查看要求</button>
    </article>
  `).join('') || '<p class="empty">暂无岗位要求。插件首次遇到新岗位时会尝试打开职位详情并保存。</p>';

  document.querySelectorAll('[data-job-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.jobRequirements[Number(button.dataset.jobIndex)];
      openDialog(`${item.role || '岗位要求'}`, item.requirement || '');
    });
  });
}

function buildCandidateDetail(item) {
  let raw = {};
  try {
    raw = JSON.parse(item.raw_json || '{}');
  } catch (err) {
    raw = {};
  }
  const evaluation = raw.evaluation || {};
  const dimensions = evaluation.dimensions || {};
  const rejectionReasons = evaluation.rejectionReasons || [];
  const topLevelText = cleanCandidateSnapshot(raw.topLevelText || raw.rawText || raw.summary || '');
  const resumeType = raw.hasAttachmentResume || raw.resumeAttachmentType === 'attachment' || raw.resumeEvidence === 'attachmentAccepted'
    ? '有附件简历'
    : (raw.hasResume ? '无附件简历' : '未获取简历');
  return [
    `姓名：${item.name || '未识别'}`,
    `岗位：${item.role || '待确认'}`,
    `简历类型：${resumeType}`,
    `简历状态：${raw.resumeStatus || '未记录'}`,
    `求简历状态：${raw.resumeRequestStatus || '未记录'}${raw.resumeRequestError ? `｜${raw.resumeRequestError}` : ''}`,
    raw.resumeRequestMethod ? `求简历方式：${raw.resumeRequestMethod === 'message' ? '发送消息' : '点击按钮'}` : '',
    raw.resumeRequestMessage ? `求简历话术：${raw.resumeRequestMessage}` : '',
    `学历：${item.education || raw.education || '未识别'}`,
    `经验：${item.experience || raw.experience || '未识别'}`,
    `薪资：${item.expected_salary || raw.expectedSalary || '未识别'}`,
    `匹配度：${item.score || 0}%`,
    `推荐意见：${item.recommendation || '待评估'}`,
    `数据来源：${item.source || '未知'}｜账号：${item.account_name || '未识别'}`,
    '',
    '候选人顶层信息：',
    topLevelText || '未采集到候选人顶层简历信息',
    '',
    '不推荐/风险依据：',
    ...(rejectionReasons.length ? rejectionReasons.map(item => `- ${item}`) : (evaluation.risks || []).map(item => `- ${item}`)),
    '',
    '评分维度：',
    `- 硬性条件：${dimensions.hard?.score ?? '-'} / ${dimensions.hard?.max ?? '-'}`,
    `- 技能匹配：${dimensions.skills?.score ?? '-'} / ${dimensions.skills?.max ?? '-'}`,
    `- 项目经验：${dimensions.projects?.score ?? '-'} / ${dimensions.projects?.max ?? '-'}`,
    `- 薪资匹配：${dimensions.salary?.score ?? '-'} / ${dimensions.salary?.max ?? '-'}`,
    `- 岗位JD：${dimensions.jd?.match || '未评估'}，匹配 ${dimensions.jd?.matched?.join('、') || '暂无'}，缺失 ${dimensions.jd?.missing?.join('、') || '暂无'}`,
  ].join('\n');
}

function applyFilters() {
  state.filters = {
    q: $('searchInput').value.trim(),
    source: $('sourceFilter').value.trim(),
    account: $('accountFilter').value.trim(),
  };
  loadData().catch(showError);
}

function clearFilters() {
  $('searchInput').value = '';
  $('sourceFilter').value = '';
  $('accountFilter').value = '';
  applyFilters();
}

function exportCsv(type) {
  const qs = queryString();
  const path = type === 'recommendations'
    ? '/api/export/recommendations.csv'
    : '/api/export/candidates.csv';
  location.href = apiUrl(qs ? `${path}?${qs}` : path);
}

async function ask(replyToDingTalk = false) {
  const question = $('questionInput').value.trim();
  if (!question) {
    toast('请输入问题', 'warning');
    return;
  }
  $('answerBox').textContent = 'Agent 正在查询历史数据...';
  const result = await api('/api/agent/ask', {
    method: 'POST',
    body: JSON.stringify({ question, replyToDingTalk }),
  });
  $('answerBox').textContent = result.answer;
  await loadConversations();
  if (replyToDingTalk) toast('答案已推送钉钉');
}

async function testDingTalk() {
  await saveSettings(false);
  const result = await api('/api/dingtalk/test', { method: 'POST', body: '{}' });
  toast(result.success ? '钉钉测试消息已发送' : result.message, result.success ? 'success' : 'warning');
}

async function pushYesterday() {
  await saveSettings(false);
  const result = await api(`/api/summary/push${buildSummaryQuery()}`, { method: 'POST', body: '{}' });
  const fileText = result.excelFile?.success ? 'Excel 文件已发送' : (result.excelFile?.message || 'Excel 文件未发送');
  toast(result.success ? `汇总已推送，${fileText}` : result.message, result.success ? 'success' : 'warning');
}

function pushRangeLabel(mode) {
  return ({
    yesterday: '昨日',
    today: '今日',
    last7: '近7天',
    custom: '自定义时间',
  })[mode || 'yesterday'] || '昨日';
}

function buildSummaryQuery() {
  const params = new URLSearchParams();
  params.set('scope', $('scheduledPushRangeMode').value || 'yesterday');
  if ($('scheduledPushRangeMode').value === 'custom') {
    if ($('scheduledPushStart').value) params.set('start', $('scheduledPushStart').value);
    if ($('scheduledPushEnd').value) params.set('end', $('scheduledPushEnd').value);
  }
  return `?${params.toString()}`;
}

function exportSummaryExcel() {
  window.open(apiUrl(`/api/summary/excel${buildSummaryQuery()}`), '_blank');
}

async function saveJobRequirement() {
  const payload = {
    role: $('jobRoleInput').value.trim(),
    source: $('jobSourceInput').value.trim() || '手动录入',
    accountName: $('jobAccountInput').value.trim() || $('accountName').value.trim(),
    requirement: $('jobRequirementInput').value.trim(),
  };
  if (!payload.role || !payload.requirement) {
    toast('请填写岗位名称和岗位要求', 'warning');
    return;
  }
  const result = await api('/api/job-requirements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  $('jobRoleInput').value = '';
  $('jobRequirementInput').value = '';
  await loadData();
  toast(`岗位要求已保存，已匹配 ${result.matchedCandidates || 0} 位候选人`);
}

async function matchAllJobRequirements() {
  const result = await api('/api/job-requirements/match-candidates', {
    method: 'POST',
    body: '{}',
  });
  await loadData();
  toast(`已重新匹配 ${result.updated || 0} 位候选人，跳过 ${result.skipped || 0} 位`);
}

async function previewSummary() {
  await saveSettings(false);
  const result = await api(`/api/summary${buildSummaryQuery()}`);
  openDialog('招聘数据汇总预览', result.markdown || '');
}

function openDialog(title, content) {
  $('dialogTitle').textContent = title;
  $('dialogContent').textContent = content;
  $('detailDialog').showModal();
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `${name}Tab`);
  });
}

function showModule(name) {
  document.querySelectorAll('.module-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.module === name);
  });
  document.querySelectorAll('.module-section').forEach(section => {
    section.classList.toggle('active', section.dataset.module === name);
  });
}

function showError(err) {
  toast(err.message || '操作失败', 'danger');
  $('answerBox').textContent = `操作失败：${err.message}`;
}

function bindEvents() {
  $('refreshBtn').addEventListener('click', () => refreshAll().catch(showError));
  $('saveSettingsBtn').addEventListener('click', () => saveSettings().catch(showError));
  $('saveAccountSettingsBtn').addEventListener('click', () => saveSettings().catch(showError));
  $('saveLlmBtn').addEventListener('click', () => saveLlmConfig().catch(showError));
  $('testLlmBtn').addEventListener('click', () => testLlm().catch(showError));
  $('resetLlmBtn').addEventListener('click', () => resetLlmConfig().catch(showError));
  $('llmProvider').addEventListener('change', () => applyLlmProviderPreset(true));
  $('toggleScheduleBtn').addEventListener('click', () => toggleSchedule().catch(showError));
  $('testDingTalkBtn').addEventListener('click', () => testDingTalk().catch(showError));
  $('pushYesterdayBtn').addEventListener('click', () => pushYesterday().catch(showError));
  $('exportSummaryExcelBtn').addEventListener('click', exportSummaryExcel);
  $('saveBehaviorBtn').addEventListener('click', () => saveBehaviorPolicy().catch(showError));
  $('loadBehaviorBtn').addEventListener('click', () => loadBehaviorPolicy().catch(showError));
  $('saveJobRequirementBtn').addEventListener('click', () => saveJobRequirement().catch(showError));
  $('matchJobsBtn').addEventListener('click', () => matchAllJobRequirements().catch(showError));
  $('previewSummaryBtn').addEventListener('click', () => previewSummary().catch(showError));
  $('askBtn').addEventListener('click', () => ask(false).catch(showError));
  $('askAndPushBtn').addEventListener('click', () => ask(true).catch(showError));
  $('applyFilterBtn').addEventListener('click', applyFilters);
  $('clearFilterBtn').addEventListener('click', clearFilters);
  $('exportCandidatesBtn').addEventListener('click', () => exportCsv('candidates'));
  $('exportRecommendationsBtn').addEventListener('click', () => exportCsv('recommendations'));
  $('saveApiBaseBtn').addEventListener('click', () => {
    const value = normalizeApiBase($('apiBaseInput').value);
    if (value) {
      localStorage.setItem(API_BASE_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
    renderApiBase();
    refreshAll().catch(showError);
  });
  $('resetApiBaseBtn').addEventListener('click', () => {
    localStorage.removeItem(API_BASE_STORAGE_KEY);
    renderApiBase();
    refreshAll().catch(showError);
  });
  $('closeDialogBtn').addEventListener('click', () => $('detailDialog').close());
  $('searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilters();
  });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
  document.querySelectorAll('.module-tab').forEach(tab => {
    tab.addEventListener('click', () => showModule(tab.dataset.module));
  });
}

async function refreshAll() {
  renderApiBase();
  await Promise.all([loadHealth(), loadSettings(), loadBehaviorPolicy()]);
  await loadData();
}

bindEvents();
refreshAll().catch(showError);
