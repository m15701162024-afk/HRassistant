const $ = (id) => document.getElementById(id);

const state = {
  settings: {},
  stats: {},
  candidates: [],
  recommendations: [],
  reports: [],
  jobRequirements: [],
  conversations: [],
  accounts: [],
  behaviorPolicy: {},
  automationTasks: [],
  actionLogs: [],
  pushRecords: [],
  users: [],
  accountBindings: [],
  security: {},
  filters: {
    q: '',
    source: '',
    account: '',
    accountExact: '',
    role: '',
    status: '',
    scoreMin: '',
  },
};

const API_BASE_STORAGE_KEY = 'recruitmentAdminApiBase';
const DEFAULT_PUBLIC_BASE_URL = 'https://unconfuted-superbusily-ryan.ngrok-free.dev';
const LLM_PROVIDER_DEFAULTS = {
  siliconflow: {
    apiBase: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3.2',
    keyUrl: 'https://cloud.siliconflow.cn/me/account/ak',
    description: '使用硅基流动 OpenAI-compatible Chat Completions，适合无 OpenAI 额度时调用。',
  },
  zhipu: {
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5v',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    description: '清华系智谱 GLM，支持页面 OCR/视觉理解与中文 NLP 抽取，适合增强插件识别候选人界面。',
  },
  'openai-codex': {
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-5.2-codex',
    keyUrl: 'https://platform.openai.com/api-keys',
    description: '使用 OpenAI Responses API，需要 OpenAI Platform API Key。',
  },
  openai: {
    apiBase: '',
    model: '',
    keyUrl: 'https://platform.openai.com/api-keys',
    description: '使用 OpenAI-compatible Chat Completions。',
  },
  claude: {
    apiBase: 'https://api.anthropic.com/v1',
    model: '',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    description: '使用 Anthropic Messages API。',
  },
  qwen: {
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    description: '使用通义千问 OpenAI-compatible Chat Completions。',
  },
  aliyun: {
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    description: '使用阿里云百炼 OpenAI-compatible Chat Completions。',
  },
  deepseek: {
    apiBase: 'https://api.deepseek.com/v1',
    model: '',
    description: '使用 DeepSeek OpenAI-compatible Chat Completions。',
  },
  custom: {
    apiBase: '',
    model: '',
    description: '使用自定义 OpenAI-compatible Chat Completions。',
  },
};

function defaultApiBase() {
  if (location.protocol === 'file:') return DEFAULT_PUBLIC_BASE_URL;
  return '';
}

function isServedByWebBackend() {
  return /^https?:$/i.test(location.protocol);
}

function getApiBase() {
  const saved = normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY));
  if (isServedByWebBackend()) {
    const currentOrigin = normalizeApiBase(location.origin);
    if (saved && saved !== currentOrigin) {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
    return saved === currentOrigin ? saved : '';
  }
  return saved || defaultApiBase();
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
  const requestUrl = apiUrl(path);
  let response;
  try {
    response = await fetch(requestUrl, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    throw new Error(`无法连接后端：${requestUrl}。请刷新页面后重试；如果通过内网地址访问，应使用当前地址 ${location.origin}。`);
  }
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let data;
  if (contentType.includes('application/json')) {
    data = raw ? JSON.parse(raw) : {};
  } else {
    const preview = raw.replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`接口返回的不是 JSON。请确认后端服务已启动且后端地址正确。当前请求：${requestUrl}；返回：${preview}`);
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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
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

function maskSensitiveText(text) {
  if (state.settings.maskSensitiveDisplay === false) return String(text || '');
  return String(text || '')
    .replace(/1[3-9]\d{9}/g, value => `${value.slice(0, 3)}****${value.slice(-4)}`)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, value => {
      const [name, domain] = value.split('@');
      return `${name.slice(0, 2)}***@${domain}`;
    })
    .replace(/微信[:：\s]*[A-Za-z0-9_-]{5,}/gi, '微信：***')
    .replace(/VX[:：\s]*[A-Za-z0-9_-]{5,}/gi, 'VX：***');
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

function linesFromText(value) {
  return String(value || '')
    .split(/\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean);
}

function setTextareaLines(id, items) {
  const el = $(id);
  if (el) el.value = (items || []).join('\n');
}

function appendUniqueTextareaLine(id, value) {
  const text = String(value || '').trim();
  if (!text) return;
  const items = linesFromText($(id).value);
  if (!items.includes(text)) items.push(text);
  setTextareaLines(id, items);
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

function currentBackendUrl() {
  const base = normalizeApiBase(getApiBase());
  if (base) return base;
  if (/^https?:$/i.test(location.protocol)) return normalizeApiBase(location.origin);
  return 'http://10.100.60.5:8787';
}

async function loadExtensionPackageInfo() {
  const backendUrl = currentBackendUrl();
  if ($('pluginBackendUrl')) $('pluginBackendUrl').textContent = backendUrl;
  if (!$('extensionPackageStatus')) return;
  try {
    const result = await api(`/api/extension/config?backendUrl=${encodeURIComponent(backendUrl)}`);
    $('extensionPackageStatus').textContent = `可下载｜${result.hostPermission || backendUrl}`;
    $('extensionPackageStatus').className = 'badge ok';
  } catch (err) {
    $('extensionPackageStatus').textContent = '生成失败';
    $('extensionPackageStatus').className = 'badge danger';
  }
}

function downloadExtensionPackage() {
  const backendUrl = currentBackendUrl();
  const path = `/api/extension/package?backendUrl=${encodeURIComponent(backendUrl)}`;
  window.location.href = apiUrl(path);
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
  if ($('saveRawResumeText')) $('saveRawResumeText').value = settings.saveRawResumeText === false ? 'false' : 'true';
  if ($('maskSensitiveDisplay')) $('maskSensitiveDisplay').value = settings.maskSensitiveDisplay === false ? 'false' : 'true';
  $('llmEnabled').value = settings.llmEnabled ? 'true' : 'false';
  $('llmProvider').value = settings.llmProvider || 'siliconflow';
  $('llmApiBase').value = settings.llmApiBase || '';
  $('llmApiKey').value = '';
  $('llmApiKey').placeholder = settings.llmApiKeyConfigured ? '已配置，留空则保留原 Key' : '请输入 API Key';
  $('llmModel').value = settings.llmModel || '';
  $('llmTemperature').value = settings.llmTemperature ?? 0.2;
  $('llmMaxContextItems').value = settings.llmMaxContextItems ?? 80;
  $('llmMaxTokens').value = settings.llmMaxTokens ?? 1000;
  if ($('llmTimeoutSeconds')) $('llmTimeoutSeconds').value = settings.llmTimeoutSeconds ?? 90;
  if ($('pageIntelligenceEnabled')) $('pageIntelligenceEnabled').value = settings.pageIntelligenceEnabled === false ? 'false' : 'true';
  if ($('pageIntelligenceUseScreenshot')) $('pageIntelligenceUseScreenshot').value = settings.pageIntelligenceUseScreenshot ? 'true' : 'false';
  renderLlmProviderHint();
  const providerName = $('llmProvider').selectedOptions?.[0]?.textContent || settings.llmProvider || '硅基流动';
  $('llmStatus').textContent = settings.llmEnabled
    ? `已启用 ${providerName}｜${settings.llmModel || '模型'}`
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

async function loadAccounts() {
  const result = await api('/api/accounts');
  state.accounts = result.items || [];
  renderAccountScope();
  renderManagedAccountList();
}

async function loadUsers() {
  const result = await api('/api/users');
  state.users = result.users || [];
  state.accountBindings = result.bindings || [];
  renderUsers();
}

async function loadActionLogs() {
  const params = new URLSearchParams();
  params.set('limit', '80');
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.account) params.set('account', state.filters.account);
  const result = await api(`/api/action-logs?${params.toString()}`);
  state.actionLogs = result.items || [];
  renderActionLogs();
}

async function loadPushRecords() {
  const params = new URLSearchParams();
  params.set('limit', '30');
  if (state.filters.account) params.set('account', state.filters.account);
  const result = await api(`/api/push-records?${params.toString()}`);
  state.pushRecords = result.items || [];
  renderPushRecords();
}

async function loadSecurityConfig() {
  const result = await api('/api/security/allowlist');
  state.security = result;
  const editable = result.editable || {};
  const effective = result.effective || {};
  const current = result.current || {};
  setTextareaLines('securityAllowedHosts', editable.allowedHosts || []);
  setTextareaLines('securityAllowedOrigins', editable.allowedOrigins || []);
  setTextareaLines('securityAllowedClientIps', editable.allowedClientIps || []);
  $('securityRateLimit').value = editable.rateLimitPerMinute ?? effective.rateLimitPerMinute ?? 240;
  $('securityMaxJsonBodyBytes').value = editable.maxJsonBodyBytes ?? effective.maxJsonBodyBytes ?? 1048576;
  $('securityKeepCurrentAccess').checked = true;
  $('securityStatus').textContent = effective.clientIpAllowlistEnabled ? 'IP已限制' : '内网开放';
  $('securityStatus').className = effective.clientIpAllowlistEnabled ? 'badge warning' : 'badge ok';
  $('securityRuntimeInfo').innerHTML = [
    ['当前 Host', current.host || '-'],
    ['当前 Origin', current.origin || '-'],
    ['当前客户端 IP', current.clientIp || '-'],
    ['生效 Host 数', (effective.allowedHosts || []).length],
    ['生效 Origin 数', (effective.allowedOrigins || []).length],
    ['配置文件', result.filePath || '-'],
  ].map(([label, value]) => `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

function addCurrentSecurityAccess() {
  const current = state.security.current || {};
  appendUniqueTextareaLine('securityAllowedHosts', current.host);
  appendUniqueTextareaLine('securityAllowedOrigins', current.origin);
  toast('已加入当前访问 Host/Origin');
}

async function saveSecurityConfig() {
  const payload = {
    allowedHosts: linesFromText($('securityAllowedHosts').value),
    allowedOrigins: linesFromText($('securityAllowedOrigins').value),
    allowedClientIps: linesFromText($('securityAllowedClientIps').value),
    rateLimitPerMinute: Number($('securityRateLimit').value || 0),
    maxJsonBodyBytes: Number($('securityMaxJsonBodyBytes').value || 1048576),
    keepCurrentAccess: $('securityKeepCurrentAccess').checked,
  };
  const result = await api('/api/security/allowlist', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  state.security = result;
  await loadSecurityConfig();
  toast('白名单配置已保存并立即生效');
}

function renderAccountScope() {
  const select = $('accountScopeSelect');
  if (!select) return;
  const selected = state.filters.account || '';
  const accounts = [...state.accounts];
  if (selected && !accounts.some(item => item.name === selected)) {
    accounts.unshift({ name: selected, count: 0 });
  }
  select.innerHTML = [
    '<option value="">全部账号</option>',
    ...accounts.map(item => {
      const label = `${item.name || '未识别'}${Number(item.count || 0) ? `（${item.count}）` : ''}`;
      return `<option value="${escapeHtml(item.name || '未识别')}">${escapeHtml(label)}</option>`;
    }),
  ].join('');
  select.value = selected;
  if ($('accountFilter')) $('accountFilter').value = selected;
  if ($('accountScopeSearch')) $('accountScopeSearch').value = selected;
  if ($('remoteTaskAccount') && !$('remoteTaskAccount').value) {
    $('remoteTaskAccount').value = state.accounts.some(item => item.name === selected) ? selected : '';
  }
  if ($('accountOptions')) {
    $('accountOptions').innerHTML = accounts.map(item => (
      `<option value="${escapeHtml(item.name || '未识别')}">${escapeHtml(item.platform || 'BOSS直聘')}</option>`
    )).join('');
  }
  $('accountScopeHint').textContent = selected
    ? (state.filters.accountExact
      ? `当前只显示账号「${selected}」的数据`
      : `当前按账号关键词「${selected}」筛选数据`)
    : '当前显示全部账号数据';
}

function renderManagedAccountList() {
  const container = $('managedAccountList');
  if (!container) return;
  if (!state.accounts.length) {
    container.innerHTML = '<div class="empty-state">暂无账号，可在上方手动新增。</div>';
    return;
  }
  container.innerHTML = state.accounts.map(item => `
    <div class="account-list-item">
      <strong>${escapeHtml(item.name || '未识别')}</strong>
      <span>${escapeHtml(item.platform || 'BOSS直聘')}</span>
      <span>${Number(item.count || 0)} 条</span>
      <button class="secondary small" data-account-select="${escapeHtml(item.name || '')}">编辑/筛选</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-account-select]').forEach(button => {
    button.addEventListener('click', () => {
      const name = button.dataset.accountSelect || '';
      const account = state.accounts.find(item => item.name === name) || {};
      $('accountName').value = name;
      $('accountPlatform').value = account.platform || 'BOSS直聘';
      setAccountScope(name);
      showModule('accounts');
    });
  });
}

function renderUsers() {
  const userList = $('userList');
  const bindingList = $('bindingList');
  if (userList) {
    userList.innerHTML = (state.users || []).map(item => `
      <div class="account-list-item">
        <strong>${escapeHtml(item.username || '')}</strong>
        <span>${escapeHtml(item.role === 'admin' ? '管理员' : '普通用户')}</span>
        <span>${escapeHtml(({ pending: '待审核', active: '已启用', disabled: '已停用', rejected: '已拒绝' })[item.status] || item.status || '')}</span>
        <button class="secondary small" data-user-edit="${escapeHtml(item.username || '')}">编辑</button>
      </div>
    `).join('') || '<div class="empty-state">暂无用户。</div>';
    userList.querySelectorAll('[data-user-edit]').forEach(button => {
      button.addEventListener('click', () => {
        const item = state.users.find(user => user.username === button.dataset.userEdit) || {};
        $('userUsername').value = item.username || '';
        $('userRole').value = item.role || 'user';
        $('userStatus').value = item.status || 'pending';
        $('userPassword').value = '';
      });
    });
  }
  if (bindingList) {
    bindingList.innerHTML = (state.accountBindings || []).map(item => `
      <div class="account-list-item">
        <strong>${escapeHtml(item.username || '')}</strong>
        <span>${escapeHtml(item.account_name || '')}</span>
        <span>${escapeHtml(({ pending: '待审核', approved: '已通过', rejected: '已拒绝', disabled: '已停用' })[item.status] || item.status || '')}</span>
        <button class="secondary small" data-binding-edit="${escapeHtml(item.id || '')}">编辑</button>
      </div>
    `).join('') || '<div class="empty-state">暂无账号绑定。</div>';
    bindingList.querySelectorAll('[data-binding-edit]').forEach(button => {
      button.addEventListener('click', () => {
        const item = state.accountBindings.find(binding => binding.id === button.dataset.bindingEdit) || {};
        $('bindingUsername').value = item.username || '';
        $('bindingAccountName').value = item.account_name || '';
        $('bindingAccountPlatform').value = item.account_platform || 'BOSS直聘';
        $('bindingStatus').value = item.status || 'pending';
      });
    });
  }
}

function setAccountScope(account, reload = true) {
  state.filters.account = String(account || '').trim();
  state.filters.accountExact = state.accounts.some(item => item.name === state.filters.account) ? '1' : '';
  if ($('accountFilter')) $('accountFilter').value = state.filters.account;
  if ($('accountScopeSearch')) $('accountScopeSearch').value = state.filters.account;
  if ($('remoteTaskAccount')) {
    $('remoteTaskAccount').value = state.accounts.some(item => item.name === state.filters.account) ? state.filters.account : '';
  }
  renderAccountScope();
  if (reload) {
    Promise.all([loadData(), loadBehaviorPolicy()]).catch(showError);
  }
}

function exactAccountScope() {
  const account = state.filters.account || '';
  return state.accounts.some(item => item.name === account) ? account : '';
}

async function saveLlmConfig(showToast = true) {
  const payload = {
    llmEnabled: $('llmEnabled').value === 'true',
    llmProvider: $('llmProvider').value || 'siliconflow',
    llmApiBase: $('llmApiBase').value.trim(),
    llmModel: $('llmModel').value.trim(),
    llmTemperature: Number($('llmTemperature').value || 0.2),
    llmMaxContextItems: Number($('llmMaxContextItems').value || 80),
    llmMaxTokens: Number($('llmMaxTokens').value || 1000),
    llmTimeoutSeconds: Number(($('llmTimeoutSeconds')?.value || 90)),
    pageIntelligenceEnabled: $('pageIntelligenceEnabled')?.value !== 'false',
    pageIntelligenceUseScreenshot: $('pageIntelligenceUseScreenshot')?.value === 'true',
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
  const provider = $('llmProvider').value || 'siliconflow';
  const preset = LLM_PROVIDER_DEFAULTS[provider] || LLM_PROVIDER_DEFAULTS.siliconflow;
  if (force || !$('llmApiBase').value.trim()) {
    $('llmApiBase').value = preset.apiBase;
  }
  if (force || !$('llmModel').value.trim()) {
    $('llmModel').value = preset.model;
  }
  renderLlmProviderHint();
}

function renderLlmProviderHint() {
  const hint = $('llmProviderHint');
  if (!hint) return;
  const provider = $('llmProvider').value || 'siliconflow';
  const preset = LLM_PROVIDER_DEFAULTS[provider] || LLM_PROVIDER_DEFAULTS.custom;
  const keyLink = preset.keyUrl
    ? ` API Key：<a href="${escapeHtml(preset.keyUrl)}" target="_blank" rel="noreferrer">打开平台密钥页面</a>`
    : '';
  hint.innerHTML = `${escapeHtml(preset.description || '')}${keyLink}`;
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
    body: JSON.stringify({ question: '请分析当前招聘历史数据，并给出一句话优化建议', sender: 'LLM 配置测试', forceLlm: true }),
  });
  $('answerBox').textContent = `${result.answer}\n\n${formatAgentMode(result.agent)}`;
  await loadConversations();
}

function formatAgentMode(agent = {}) {
  const parts = [
    agent.mode || 'unknown',
    agent.providerLabel || agent.provider || '',
    agent.model || '',
  ].filter(Boolean);
  return `[Agent 模式] ${parts.join('｜')}`;
}

async function loadBehaviorPolicy() {
  const account = exactAccountScope();
  const policy = await api(`/api/behavior-policy${account ? `?account=${encodeURIComponent(account)}` : ''}`);
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
  if ($('behaviorAccountHint')) {
    $('behaviorAccountHint').textContent = account
      ? `当前编辑账号「${account}」的自动化策略和关键词分散池。`
      : (state.filters.account
        ? `当前账号搜索「${state.filters.account}」不是完整账号名，正在编辑全部账号默认策略。`
        : '当前编辑全部账号的默认自动化策略；选择具体账号后可单独配置。');
  }
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
    accountName: exactAccountScope(),
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

function taskStatusLabel(status) {
  return ({
    pending: '待领取',
    claimed: '已领取',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  })[status] || status || '未知';
}

function taskStatusClass(status) {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'pending' || status === 'claimed' || status === 'running') return 'warning';
  return '';
}

function renderAutomationTasks() {
  const container = $('automationTaskList');
  if (!container) return;
  const items = state.automationTasks || [];
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">暂无远程任务。下发后，在线插件会按账号领取并执行。</div>';
    return;
  }
  container.innerHTML = items.slice(0, 20).map(item => {
    const result = item.result || {};
    const processed = result.processed ?? result.processedCount ?? result.savedCount ?? '-';
    const message = item.error_message || result.message || result.summary || '';
    return `
      <article class="task-item">
        <div>
          <strong>${escapeHtml(item.account_name || '任意账号')}｜候选人 ${escapeHtml(item.max_candidates || 0)} 人</strong>
          <div class="task-meta">
            <span>创建：${escapeHtml(item.created_at || '')}</span>
            <span>更新：${escapeHtml(item.updated_at || '')}</span>
            <span>执行插件：${escapeHtml(item.claimed_by || '未领取')}</span>
            <span>已处理：${escapeHtml(processed)}</span>
            ${message ? `<span>结果：${escapeHtml(message)}</span>` : ''}
          </div>
        </div>
        <span class="badge ${taskStatusClass(item.status)}">${escapeHtml(taskStatusLabel(item.status))}</span>
      </article>
    `;
  }).join('');
}

function renderActionLogs() {
  const container = $('actionLogList');
  if (!container) return;
  const items = state.actionLogs || [];
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">暂无动作证据或异常日志。</div>';
    return;
  }
  container.innerHTML = items.slice(0, 80).map(item => `
    <article class="task-item">
      <div>
        <strong>${escapeHtml(item.candidate_name || '未关联候选人')}｜${escapeHtml(item.role || '待确认岗位')}</strong>
        <div class="task-meta">
          <span>${escapeHtml(item.created_at || '')}</span>
          <span>动作：${escapeHtml(item.action_type || '')}</span>
          <span>按钮：${escapeHtml(item.button_text || '-')}</span>
          <span>账号：${escapeHtml(item.account_name || '未识别')}</span>
          ${item.error_message ? `<span>错误：${escapeHtml(item.error_message)}</span>` : ''}
        </div>
      </div>
      <span class="badge ${item.result === 'failed' ? 'danger' : 'ok'}">${escapeHtml(item.result || '记录')}</span>
    </article>
  `).join('');
}

function renderPushRecords() {
  const container = $('pushRecordList');
  if (!container) return;
  const items = state.pushRecords || [];
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">暂无推送记录。</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <article class="task-item">
      <div>
        <strong>${escapeHtml(item.label || '推送范围')}｜${escapeHtml(item.account_name || '全部账号')}</strong>
        <div class="task-meta">
          <span>${escapeHtml(item.created_at || '')}</span>
          <span>候选人：${escapeHtml(item.candidate_count || 0)}</span>
          <span>收到简历：${escapeHtml(item.resume_count || 0)}</span>
          <span>推荐：${escapeHtml(item.recommendation_count || 0)}</span>
          <span>Excel：${escapeHtml(item.excel_file || '-')}</span>
          ${item.excel_url ? `<span><a href="${escapeHtml(item.excel_url)}" target="_blank" rel="noreferrer">下载入口</a></span>` : ''}
        </div>
      </div>
      <span class="badge ${/failed|失败/i.test(item.delivery_status || item.message || '') ? 'danger' : 'ok'}">${escapeHtml(item.delivery_status || '已记录')}</span>
    </article>
  `).join('');
}

async function loadAutomationTasks() {
  const params = new URLSearchParams();
  params.set('limit', '30');
  if (state.filters.account) params.set('account', state.filters.account);
  const result = await api(`/api/automation/tasks?${params.toString()}`);
  state.automationTasks = result.items || [];
  renderAutomationTasks();
}

async function createRemoteTask() {
  const account = $('remoteTaskAccount').value.trim() || exactAccountScope();
  const maxCandidates = Number($('remoteTaskMaxCandidates').value || $('maxCandidatesPerRun').value || 20);
  const result = await api('/api/automation/tasks', {
    method: 'POST',
    body: JSON.stringify({
      taskType: 'recruitmentWorkflow',
      accountName: account,
      maxCandidates,
    }),
  });
  if (!result.success) {
    toast(result.message || '远程任务下发失败', 'danger');
    return;
  }
  await loadAutomationTasks();
  toast('任务已下发，插件将在下一轮轮询时自动领取执行');
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
      pageIntelligenceEnabled: $('pageIntelligenceEnabled')?.value !== 'false',
      pageIntelligenceUseScreenshot: $('pageIntelligenceUseScreenshot')?.value === 'true',
    }),
  });
  await loadSettings();
  if (showToast) toast('配置已保存');
  await loadAccounts();
}

async function addManagedAccount() {
  const name = $('accountName').value.trim();
  const platform = $('accountPlatform').value.trim() || 'BOSS直聘';
  if (!name) {
    toast('请输入账号名称', 'warning');
    return;
  }
  await api('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name, platform }),
  });
  await loadAccounts();
  setAccountScope(name);
  toast('账号已新增/更新');
}

async function saveUser() {
  const payload = {
    username: $('userUsername').value.trim(),
    role: $('userRole').value,
    status: $('userStatus').value,
    password: $('userPassword').value.trim(),
  };
  if (!payload.username) {
    toast('请输入用户名', 'warning');
    return;
  }
  const result = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  state.users = result.users || [];
  state.accountBindings = result.bindings || [];
  $('userPassword').value = '';
  renderUsers();
  toast('用户已保存');
}

async function saveBinding() {
  const payload = {
    username: $('bindingUsername').value.trim(),
    accountName: $('bindingAccountName').value.trim(),
    accountPlatform: $('bindingAccountPlatform').value.trim() || 'BOSS直聘',
    status: $('bindingStatus').value,
    reviewedBy: 'admin',
  };
  if (!payload.username || !payload.accountName) {
    toast('请输入用户名和招聘账号', 'warning');
    return;
  }
  const result = await api('/api/account-bindings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  state.users = result.users || [];
  state.accountBindings = result.bindings || [];
  renderUsers();
  toast('账号绑定已保存');
}

async function saveDataPolicy() {
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      saveRawResumeText: $('saveRawResumeText').value === 'true',
      maskSensitiveDisplay: $('maskSensitiveDisplay').value === 'true',
    }),
  });
  await loadSettings();
  toast('数据策略已保存');
}

async function cleanupData() {
  const account = $('cleanupAccount').value.trim();
  const before = $('cleanupBefore').value;
  if (!account && !before) {
    toast('请至少填写清理账号或截止日期', 'warning');
    return;
  }
  const result = await api('/api/data/cleanup', {
    method: 'POST',
    body: JSON.stringify({ account, before }),
  });
  await Promise.all([loadData(), loadActionLogs(), loadUsers()]);
  toast(`清理完成：候选人 ${result.deleted?.candidates || 0} 条，推荐 ${result.deleted?.recommendations || 0} 条`);
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
      pageIntelligenceEnabled: $('pageIntelligenceEnabled')?.value !== 'false',
      pageIntelligenceUseScreenshot: $('pageIntelligenceUseScreenshot')?.value === 'true',
      scheduledPushEnabled: !settings.scheduledPushEnabled,
    }),
  });
  await loadSettings();
  toast(settings.scheduledPushEnabled ? '已关闭定时推送' : '已开启定时推送');
}

async function loadData() {
  const qs = queryString();
  const suffix = qs ? `&${qs}` : '';
  const querySuffix = qs ? `?${qs}` : '';
  const [stats, candidates, recommendations, reports, jobs] = await Promise.all([
    api(`/api/stats${querySuffix}`),
    api(`/api/candidates?limit=500${suffix}`),
    api(`/api/recommendations?limit=500${suffix}`),
    api(`/api/reports?limit=200${suffix}`),
    api(`/api/job-requirements?limit=200${suffix}`),
  ]);

  state.stats = stats;
  state.candidates = candidates.items || [];
  state.recommendations = recommendations.items || [];
  state.reports = reports.items || [];
  state.jobRequirements = jobs.items || [];

  renderStats();
  renderBreakdowns();
  renderTables();
  await Promise.all([loadAutomationTasks(), loadActionLogs(), loadPushRecords(), loadConversations()]);
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

function parseCandidateRaw(item = {}) {
  try {
    return JSON.parse(item.raw_json || '{}');
  } catch (err) {
    return {};
  }
}

function candidateResumeType(item = {}) {
  const raw = parseCandidateRaw(item);
  if (raw.hasAttachmentResume || raw.resumeAttachmentType === 'attachment' || raw.resumeEvidence === 'attachmentAccepted') {
    return '有附件简历';
  }
  if (raw.hasResume || raw.resumeEvidence === 'onlineResumeOpened') {
    return '无附件简历';
  }
  return '未获取简历';
}

function candidateRequestStatus(item = {}) {
  const raw = parseCandidateRaw(item);
  return raw.resumeRequestStatus || (Number(item.score || 0) >= 40 ? '待索要/待复核' : '未达到阈值');
}

function candidateWorkflowStatus(item = {}) {
  const raw = parseCandidateRaw(item);
  if (raw.workflowStatus === 'processed' || raw.workflowProcessedAt) return '已处理';
  return '未记录';
}

function recommendationGroup(item = {}) {
  const score = Number(item.score || 0);
  if (score >= 80) return '强烈推荐';
  if (score >= 60) return '非常推荐';
  if (score >= 40) return '推荐';
  return '暂不推荐';
}

function renderTables() {
  $('candidateRows').innerHTML = state.candidates.map((item, index) => `
    <tr>
      <td>${escapeHtml(item.received_date)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.role)}</td>
      <td>${escapeHtml(item.education)}</td>
      <td>${escapeHtml(item.experience)}</td>
      <td>${escapeHtml(item.current_company || '')}</td>
      <td>${escapeHtml(item.expected_salary)}</td>
      <td>${escapeHtml(`${item.score || 0}%`)}</td>
      <td>${escapeHtml(item.recommendation)}</td>
      <td>${escapeHtml(item.status || candidateWorkflowStatus(item))}</td>
      <td>${escapeHtml(item.source)}</td>
      <td>${escapeHtml(item.account_name)}</td>
      <td>${escapeHtml(candidateResumeType(item))}</td>
      <td>${escapeHtml(candidateRequestStatus(item))}</td>
      <td>${escapeHtml(candidateWorkflowStatus(item))}</td>
      <td>${escapeHtml(item.last_communication_at || '')}</td>
      <td>
        <button class="secondary small" data-candidate-index="${index}">查看</button>
        <button class="secondary small" data-candidate-job-index="${index}">岗位库</button>
      </td>
    </tr>
  `).join('') || row(['-', '暂无数据', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']);

  renderCandidateInsights();

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

  document.querySelectorAll('[data-candidate-job-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.candidates[Number(button.dataset.candidateJobIndex)];
      openJobEditorForRole(item?.role || '', item?.account_name || '');
    });
  });

  $('jobRequirementList').innerHTML = state.jobRequirements.slice(0, 100).map((item, index) => `
    <article class="report">
      <div>
        <h3>
          ${escapeHtml(item.role || '未识别岗位')}
          <span class="badge ${item.status === 'pending' ? 'warning' : (item.status === 'disabled' ? 'danger' : 'ok')}">${item.status === 'pending' ? '待补录' : (item.status === 'disabled' ? '已停用' : '已入库')}</span>
        </h3>
        <p>${escapeHtml(item.source || '')}｜${escapeHtml(item.account_name || '')}｜${escapeHtml(item.updated_at || '')}</p>
        ${item.status === 'pending' ? `<p class="muted">原因：${escapeHtml(item.failure_reason || '插件未能识别工作内容/工作要求')}</p>` : ''}
      </div>
      <div class="report-actions">
        <button class="secondary small" data-job-index="${index}">${item.status === 'pending' ? '查看原因' : '查看要求'}</button>
        <button class="secondary small" data-job-edit-index="${index}">编辑</button>
        <button class="secondary small" data-job-match-index="${index}" ${item.status === 'pending' ? 'disabled' : ''}>匹配候选人</button>
        <button class="secondary small" data-job-disable-index="${index}">停用</button>
      </div>
    </article>
  `).join('') || '<p class="empty">暂无岗位要求。插件首次遇到新岗位时会尝试打开职位详情并保存。</p>';

  document.querySelectorAll('[data-job-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.jobRequirements[Number(button.dataset.jobIndex)];
      openDialog(`${item.role || '岗位要求'}`, item.requirement || item.failure_reason || '该岗位等待手动补录工作内容和工作要求。');
    });
  });

  document.querySelectorAll('[data-job-edit-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = state.jobRequirements[Number(button.dataset.jobEditIndex)];
      fillJobEditor(item);
    });
  });

  document.querySelectorAll('[data-job-match-index]').forEach(button => {
    button.addEventListener('click', async () => {
      const item = state.jobRequirements[Number(button.dataset.jobMatchIndex)];
      await matchJobRequirement(item);
    });
  });

  document.querySelectorAll('[data-job-disable-index]').forEach(button => {
    button.addEventListener('click', async () => {
      const item = state.jobRequirements[Number(button.dataset.jobDisableIndex)];
      await disableJobRequirement(item);
    });
  });
}

function renderCandidateInsights() {
  const kanban = $('candidateKanban');
  const roleView = $('candidateRoleView');
  if (!kanban || !roleView) return;

  const groups = ['强烈推荐', '非常推荐', '推荐', '暂不推荐'].map(label => {
    const items = state.candidates
      .filter(item => recommendationGroup(item) === label)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return { label, items };
  });
  kanban.innerHTML = groups.map(group => `
    <article class="kanban-column">
      <header>
        <strong>${escapeHtml(group.label)}</strong>
        <span>${group.items.length}</span>
      </header>
      ${group.items.slice(0, 8).map(item => `
        <div class="mini-candidate">
          <b>${escapeHtml(item.name || '未识别')}</b>
          <span>${escapeHtml(item.role || '待确认岗位')}</span>
          <em>${escapeHtml(item.score || 0)}%</em>
        </div>
      `).join('') || '<p class="empty small-empty">暂无</p>'}
    </article>
  `).join('');

  const byRole = new Map();
  state.candidates.forEach(item => {
    const role = item.role || '待确认岗位';
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(item);
  });
  const roleGroups = Array.from(byRole.entries())
    .map(([role, items]) => ({
      role,
      items: items.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
      avgScore: Math.round(items.reduce((sum, item) => sum + Number(item.score || 0), 0) / Math.max(1, items.length)),
      requested: items.filter(item => /已点击求简历|已索要简历|已发送求简历消息|无需索要/.test(candidateRequestStatus(item))).length,
    }))
    .sort((a, b) => b.items.length - a.items.length || b.avgScore - a.avgScore)
    .slice(0, 12);
  roleView.innerHTML = roleGroups.map(group => `
    <article class="role-group">
      <div>
        <h4>${escapeHtml(group.role)}</h4>
        <p>${group.items.length} 人｜平均 ${group.avgScore}%｜已推进 ${group.requested} 人</p>
      </div>
      <div class="role-candidates">
        ${group.items.slice(0, 5).map(item => `
          <span>${escapeHtml(item.name || '未识别')} ${escapeHtml(item.score || 0)}%</span>
        `).join('')}
      </div>
    </article>
  `).join('') || '<p class="empty">暂无候选人数据</p>';
}

function fillJobEditor(item = {}) {
  showModule('jobs');
  $('jobRoleInput').value = item.role || '';
  $('jobSourceInput').value = item.source || '手动录入';
  $('jobAccountInput').value = item.account_name || '';
  $('jobRequirementInput').value = item.requirement || '';
  $('jobRoleInput').focus();
  toast('已载入岗位要求，可直接编辑后保存');
}

function openJobEditorForRole(role = '', account = '') {
  showModule('jobs');
  const accountKey = normalizeText(account || state.filters.account || '');
  const existing = state.jobRequirements.find(item => {
    if (normalizeText(item.role) !== normalizeText(role)) return false;
    return !accountKey || !item.account_name || normalizeText(item.account_name) === accountKey;
  });
  if (existing) {
    fillJobEditor(existing);
  } else {
    $('jobRoleInput').value = role || '';
    $('jobSourceInput').value = '手动录入';
    $('jobAccountInput').value = account || '';
    $('jobRequirementInput').value = '';
    $('jobRequirementInput').focus();
    toast('岗位库中暂无该岗位，请补充 JD 后保存', 'warning');
  }
}

function buildCandidateDetail(item) {
  const raw = parseCandidateRaw(item);
  const evaluation = raw.evaluation || {};
  const dimensions = evaluation.dimensions || {};
  const rejectionReasons = evaluation.rejectionReasons || [];
  const workflowActions = Array.isArray(raw.workflowActions) ? raw.workflowActions : [];
  const topLevelText = maskSensitiveText(cleanCandidateSnapshot(raw.topLevelText || raw.rawText || raw.summary || ''));
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
    raw.resumeRequestMessage ? `求简历话术：${maskSensitiveText(raw.resumeRequestMessage)}` : '',
    `插件处理：${raw.workflowStatus === 'processed' || raw.workflowProcessedAt ? '已处理' : '未记录'}${raw.workflowProcessedAt ? `｜${raw.workflowProcessedAt}` : ''}`,
    `候选人状态：${item.status || '新增'}｜最后沟通：${item.last_communication_at || raw.lastCommunicationAt || '未记录'}`,
    `学历：${item.education || raw.education || '未识别'}`,
    `经验：${item.experience || raw.experience || '未识别'}`,
    `当前公司：${item.current_company || raw.currentCompany || '未识别'}`,
    `薪资：${item.expected_salary || raw.expectedSalary || '未识别'}`,
    `匹配度：${item.score || 0}%`,
    `推荐意见：${item.recommendation || '待评估'}`,
    `数据来源：${item.source || '未知'}｜账号：${item.account_name || '未识别'}`,
    '',
    '候选人顶层信息：',
    topLevelText || '未采集到候选人顶层简历信息',
    '',
    '插件动作证据：',
    ...(workflowActions.length
      ? workflowActions.map(action => `- ${action.at || ''}｜${action.type || 'action'}｜${action.status || ''}｜${maskSensitiveText(action.text || '')}`)
      : ['- 暂无动作证据']),
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
  const account = $('accountFilter').value.trim();
  state.filters = {
    q: $('searchInput').value.trim(),
    source: $('sourceFilter').value.trim(),
    account,
    accountExact: state.accounts.some(item => item.name === account) ? '1' : '',
    role: $('roleFilter').value.trim(),
    status: $('statusFilter').value,
    scoreMin: $('scoreMinFilter').value,
  };
  renderAccountScope();
  loadData().catch(showError);
}

function clearFilters() {
  $('searchInput').value = '';
  $('sourceFilter').value = '';
  $('accountFilter').value = '';
  $('roleFilter').value = '';
  $('statusFilter').value = '';
  $('scoreMinFilter').value = '';
  setAccountScope('', false);
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
    body: JSON.stringify({ question, replyToDingTalk, account: state.filters.account }),
  });
  $('answerBox').textContent = `${result.answer}\n\n${formatAgentMode(result.agent)}`;
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
  const deliveryText = ({
    dingtalkFile: 'Excel 文件已直发',
    downloadLinkFallback: 'Excel 下载入口已补发',
    failed: result.excelFile?.message || result.excelFallback?.message || 'Excel 文件未发送',
  })[result.excelDelivery] || (result.excelFile?.success ? 'Excel 文件已发送' : 'Excel 文件未发送');
  await loadPushRecords();
  toast(result.success ? `汇总已推送，${deliveryText}` : result.message, result.success ? 'success' : 'warning');
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
  if (state.filters.account) params.set('account', state.filters.account);
  return `?${params.toString()}`;
}

function exportSummaryExcel() {
  window.open(apiUrl(`/api/summary/excel${buildSummaryQuery()}`), '_blank');
}

async function saveJobRequirement() {
  const payload = {
    role: $('jobRoleInput').value.trim(),
    source: $('jobSourceInput').value.trim() || '手动录入',
    accountName: $('jobAccountInput').value.trim() || state.filters.account || $('accountName').value.trim(),
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

async function disableJobRequirement(item = {}) {
  const result = await api('/api/job-requirements/delete', {
    method: 'POST',
    body: JSON.stringify({ id: item.id, role: item.role, accountName: item.account_name }),
  });
  if (!result.success) {
    toast(result.message || '岗位停用失败', 'danger');
    return;
  }
  await loadData();
  toast('岗位要求已停用');
}

async function matchAllJobRequirements() {
  const result = await api('/api/job-requirements/match-candidates', {
    method: 'POST',
    body: JSON.stringify({ account: state.filters.account, accountExact: state.filters.accountExact }),
  });
  await loadData();
  openMatchedCandidatesDialog('全部岗位匹配结果', result);
  toast(`已重新匹配 ${result.updated || 0} 位候选人，跳过 ${result.skipped || 0} 位`);
}

async function matchJobRequirement(item = {}) {
  const result = await api('/api/job-requirements/match-candidates', {
    method: 'POST',
    body: JSON.stringify({
      role: item.role || '',
      account: item.account_name || state.filters.account,
      accountExact: item.account_name ? '1' : state.filters.accountExact,
    }),
  });
  await loadData();
  openMatchedCandidatesDialog(`${item.role || '该岗位'}匹配候选人`, result);
  toast(`${item.role || '该岗位'} 已匹配 ${result.updated || 0} 位候选人`);
}

function openMatchedCandidatesDialog(title, result = {}) {
  const items = result.items || [];
  const lines = [
    `已匹配：${result.updated || 0} 位`,
    `跳过：${result.skipped || 0} 位`,
    '',
    ...(items.length ? items.map((item, index) => [
      `${index + 1}. ${item.name || '未识别'}｜${item.role || '待确认'}｜${item.score || 0}%｜${item.recommendation || '待评估'}`,
      `   学历：${item.education || '未识别'}｜经验：${item.experience || '未识别'}｜薪资：${item.expected_salary || '未识别'}`,
      `   来源：${item.source || '未知'}｜账号：${item.account_name || '未识别'}｜JD：${item.jdMatch || '未评估'}`,
      `   匹配：${(item.matched || []).join('、') || '暂无'}；缺失：${(item.missing || []).join('、') || '暂无'}`,
    ].join('\n')) : ['暂无可展示的匹配候选人。']),
  ];
  openDialog(title, lines.join('\n'));
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
    const active = section.dataset.module === name;
    section.classList.toggle('active', active);
    section.hidden = !active;
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
  $('addAccountBtn').addEventListener('click', () => addManagedAccount().catch(showError));
  $('saveUserBtn').addEventListener('click', () => saveUser().catch(showError));
  $('saveBindingBtn').addEventListener('click', () => saveBinding().catch(showError));
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
  $('createRemoteTaskBtn').addEventListener('click', () => createRemoteTask().catch(showError));
  $('refreshRemoteTasksBtn').addEventListener('click', () => loadAutomationTasks().catch(showError));
  $('saveSecurityBtn').addEventListener('click', () => saveSecurityConfig().catch(showError));
  $('loadSecurityBtn').addEventListener('click', () => loadSecurityConfig().catch(showError));
  $('addCurrentSecurityBtn').addEventListener('click', addCurrentSecurityAccess);
  $('saveJobRequirementBtn').addEventListener('click', () => saveJobRequirement().catch(showError));
  $('matchJobsBtn').addEventListener('click', () => matchAllJobRequirements().catch(showError));
  $('previewSummaryBtn').addEventListener('click', () => previewSummary().catch(showError));
  $('askBtn').addEventListener('click', () => ask(false).catch(showError));
  $('askAndPushBtn').addEventListener('click', () => ask(true).catch(showError));
  $('applyFilterBtn').addEventListener('click', applyFilters);
  $('clearFilterBtn').addEventListener('click', clearFilters);
  $('exportCandidatesBtn').addEventListener('click', () => exportCsv('candidates'));
  $('exportRecommendationsBtn').addEventListener('click', () => exportCsv('recommendations'));
  $('accountScopeSelect').addEventListener('change', () => setAccountScope($('accountScopeSelect').value));
  $('accountScopeApplyBtn').addEventListener('click', () => setAccountScope($('accountScopeSearch').value));
  $('accountScopeSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') setAccountScope($('accountScopeSearch').value);
  });
  $('accountFilter').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilters();
  });
  $('saveApiBaseBtn').addEventListener('click', () => {
    const value = normalizeApiBase($('apiBaseInput').value);
    if (isServedByWebBackend() && value && value !== normalizeApiBase(location.origin)) {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
      toast(`当前通过 Web 后台访问，已使用当前地址 ${location.origin}`, 'warning');
    } else if (value && value !== normalizeApiBase(location.origin)) {
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
  $('downloadExtensionPackageBtn').addEventListener('click', downloadExtensionPackage);
  $('refreshExtensionPackageBtn').addEventListener('click', () => loadExtensionPackageInfo().catch(showError));
  $('saveDataPolicyBtn').addEventListener('click', () => saveDataPolicy().catch(showError));
  $('cleanupDataBtn').addEventListener('click', () => cleanupData().catch(showError));
  $('closeDialogBtn').addEventListener('click', () => $('detailDialog').close());
  $('searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilters();
  });
  $('roleFilter').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilters();
  });
  $('scoreMinFilter').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyFilters();
  });
  $('statusFilter').addEventListener('change', applyFilters);
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
  document.querySelectorAll('.module-tab').forEach(tab => {
    tab.addEventListener('click', () => showModule(tab.dataset.module));
  });
}

async function refreshAll() {
  renderApiBase();
  await Promise.all([loadHealth(), loadSettings(), loadAccounts(), loadUsers(), loadSecurityConfig(), loadExtensionPackageInfo()]);
  await loadBehaviorPolicy();
  await loadData();
}

bindEvents();
showModule('overview');
refreshAll().catch(showError);
