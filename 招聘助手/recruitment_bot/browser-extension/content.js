/**
 * content.js - BOSS直聘简历自动接收插件 - 内容脚本 (v2.0 安全增强版)
 *
 * ============================================================
 * 反反爬策略（学习自 GoodHR 开源方案）:
 * ============================================================
 * 1. 【人类行为模拟】使用 MouseEvent 模拟真实点击，而非 element.click()
 * 2. 【随机延迟】操作间隔使用正态分布随机延迟，而非固定值
 * 3. 【鼠标轨迹】点击前模拟鼠标移动到目标元素
 * 4. 【概率浏览】随机概率"查看"候选人详情页，模拟真人浏览行为
 * 5. 【操作限速】每日/每小时操作上限，防止高频触发风控
 * 6. 【安全降级】检测到异常时自动降级为仅抓取模式
 * 7. 【指纹隐藏】隐藏 webdriver 等自动化特征
 * 8. 【页面停留】操作间随机停留，模拟阅读行为
 * ============================================================
 *
 * 匹配页面：
 * - https://www.zhipin.com/web/recruit/geek/receive  (简历接收页)
 * - https://www.zhipin.com/web/recruit/geek/*        (候选人详情页)
 * - https://www.zhipin.com/chat/*                     (聊天页面)
 */

// ============================================================
// 配置
// ============================================================

let settings = {
  autoAccept: false,       // 【安全默认关闭】自动接收简历（默认关闭，降低风险）
  autoRequestResume: false,// 【安全默认关闭】自动索要简历
  autoBrowseProfiles: false,// 【安全默认关闭】自动浏览候选人并切换沟通界面
  autoScrape: true,        // 自动抓取信息（安全，只读取DOM）
  autoSync: true,          // 自动同步数据
  acceptDelay: 18000,      // 基础延迟（毫秒），降低自动化速度
  delayVariance: 9000,     // 延迟随机波动范围
  browseProbability: 0.55, // 概率浏览候选人详情
  dailyLimit: 20,          // 每日自动操作上限
  hourlyLimit: 6,          // 每小时自动操作上限
  maxCandidatesPerRun: 5,  // 单轮最多处理候选人
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
  accountName: '',
  accountPlatform: 'BOSS直聘',
  accountNameManual: false,
  longBreakEvery: 3,
  longBreakMin: 60000,
  longBreakMax: 150000,
  scrollBeforeClick: true, // 点击前随机滚动页面
  safeMode: true,          // 安全模式（检测到异常自动降级）
};

// 已处理的简历ID集合（避免重复处理）
const processedResumeIds = new Set();
const processedActionKeys = new Set();
const processedBrowseKeys = new Set();
const workflowProcessedKeys = new Set();
let isBrowsingCandidates = false;
let cachedJobRequirements = {};
let activeWorkflowCandidateHint = null;

const RESUME_ACTIONS = {
  accept: {
    label: '接收简历',
    keywords: ['同意', '接收', '接收简历', '查看简历', '接受简历'],
    blockedKeywords: ['已同意', '已接收', '已查看', '已处理', '不同意'],
  },
  request: {
    label: '索要简历',
    keywords: ['索要简历', '求简历', '请求简历', '要简历', '获取简历', '请求发送简历', '请发简历', '请发送简历', '发简历', '让TA发简历', '让他发简历', '让她发简历', '索要附件', '求附件', '求附件简历', '发送附件简历'],
    blockedKeywords: ['已索要', '已请求', '已获取', '等待对方'],
  },
};

const RESUME_REQUEST_FALLBACK_MESSAGE = '方便发一份您的简历过来吗？';

const WORKBENCH_TEXT = {
  sidebarNoise: /职位管理|推荐牛人|深度搜索|搜索|意向沟通|互动|牛人管理|道具|项目外包|直播招聘|更多/,
  listNoise: /心仪牛人不回应|顾问帮您打电话|全部职位|批量|未读/,
  candidateListSignal: /J\d+|工程师|开发|分析|运营|产品|实习|经理|算法|测试|前端|后端|结构|电气|工艺|SQE|DevOps|PLM|ERP/,
  candidateSummarySignal: /牛人分析器|在线|刚刚活跃|岁|本科|大专|硕士|博士|工作经历|期望职位/,
};

const AGENTS_EVALUATION_RULES = {
  hard: 20,
  skills: 30,
  projects: 30,
  salary: 20,
  recommendThreshold: 40,
  veryRecommendThreshold: 60,
  strongRecommendThreshold: 80,
};

const SKILL_KEYWORDS = [
  'JavaScript', 'TypeScript', 'React', 'Vue', 'Node', 'Java', 'Spring', 'Python',
  'Go', 'C++', 'MySQL', 'Redis', 'Docker', 'Kubernetes', '微服务', '架构',
  '自动化', '测试', '性能', '数据', '算法', '前端', '后端', '全栈', '运维',
];

const PROJECT_KEYWORDS = ['项目', '负责', '主导', '落地', '优化', '提升', '架构', '系统', '平台', '性能', '效率', '增长'];

// 操作计数器（用于限速）
let operationCount = {
  today: 0,
  hourly: 0,
  todayDate: new Date().toISOString().split('T')[0],
  currentHour: new Date().getHours(),
};

// 安全状态
let safetyState = {
  isDegraded: false,        // 是否已降级
  consecutiveErrors: 0,     // 连续错误次数
  lastOperationTime: 0,     // 上次操作时间
  warningCount: 0,          // 风控警告次数
};

// ============================================================
// 初始化
// ============================================================

async function init() {
  console.log('[招聘助手] 插件已加载 (v2.0 安全增强版)');
  await loadSettings();
  await loadJobRequirements();
  hideAutomationFingerprints();
  resetCountersIfNeeded();
  startObserving();
}

async function loadJobRequirements() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jobRequirements'], (result) => {
      cachedJobRequirements = dedupeCachedJobRequirements(result.jobRequirements || {});
      chrome.storage.local.set({ jobRequirements: cachedJobRequirements });
      resolve();
    });
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings', 'operationCount', 'safetyState'], (result) => {
      if (result.settings) {
        settings = { ...settings, ...result.settings };
      }
      if (result.operationCount) {
        operationCount = { ...operationCount, ...result.operationCount };
      }
      if (result.safetyState) {
        safetyState = { ...safetyState, ...result.safetyState };
      }
      console.log('[招聘助手] 设置已加载:', settings);
      resolve();
    });
  });
}

/**
 * 【反检测】隐藏自动化指纹
 * 参考 GoodHR 策略：移除 webdriver 等可被检测的属性
 */
function hideAutomationFingerprints() {
  try {
    // 移除 webdriver 标记
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // 伪装 plugins 数组（空数组是自动化工具的典型特征）
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ];
        plugins.length = 3;
        return plugins;
      },
    });

    // 伪装 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    });

    console.log('[招聘助手] 自动化指纹已隐藏');
  } catch (e) {
    console.warn('[招聘助手] 指纹隐藏部分失败:', e.message);
  }
}

/**
 * 重置操作计数器（跨天/跨小时）
 */
function resetCountersIfNeeded() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentHour = now.getHours();
  let changed = false;

  if (today !== operationCount.todayDate) {
    operationCount.today = 0;
    operationCount.hourly = 0;
    operationCount.todayDate = today;
    operationCount.currentHour = currentHour;
    changed = true;
    console.log('[招聘助手] 新的一天，操作计数器已重置');
  } else if (currentHour !== operationCount.currentHour) {
    operationCount.hourly = 0;
    operationCount.currentHour = currentHour;
    changed = true;
    console.log('[招聘助手] 新的小时，小时计数器已重置');
  }

  if (changed) {
    chrome.storage.local.set({ operationCount });
  }
}

// ============================================================
// 人类行为模拟引擎（核心反检测模块）
// ============================================================

/**
 * 生成人类化的随机延迟
 * 使用正态分布，中心值为 acceptDelay，标准差为 delayVariance/2
 * 最小值不低于 acceptDelay - delayVariance
 * 最大值不超过 acceptDelay + delayVariance * 2
 */
function humanDelay() {
  if (settings.behaviorPolicyEnabled && Number(settings.requestDelayMax) > 0) {
    const min = Math.max(1000, Number(settings.requestDelayMin || 5000));
    const max = Math.max(min, Number(settings.requestDelayMax || 15000));
    return Math.round(min + Math.random() * (max - min));
  }

  const min = Math.max(1000, settings.acceptDelay - settings.delayVariance);
  const max = settings.acceptDelay + settings.delayVariance * 2;
  const mean = settings.acceptDelay;
  const stdDev = settings.delayVariance / 2;

  // Box-Muller 变换生成正态分布随机数
  let u1 = Math.random();
  let u2 = Math.random();
  // 避免 log(0)
  u1 = Math.max(0.0001, u1);
  const normalRandom = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  let delay = mean + normalRandom * stdDev;

  // 限制范围
  delay = Math.max(min, Math.min(max, delay));

  return Math.round(delay);
}

/**
 * 【核心】模拟真实鼠标点击事件
 * 不使用 element.click()，而是构造完整的 MouseEvent 链
 * 使用完整事件链触发页面自身的交互监听，避免只调用 click() 时遗漏前置事件。
 */
function simulateHumanClick(element) {
  if (!element) return false;

  try {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width * (0.3 + Math.random() * 0.4); // 避免精确中心
    const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);

    // 完整的鼠标事件序列：mousemove → mouseover → mousedown → mouseup → click
    const eventSequence = [
      new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y,
      }),
      new MouseEvent('mouseover', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y,
      }),
      new MouseEvent('mouseenter', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y,
      }),
      new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y,
        button: 0, // 左键
      }),
      new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y,
        button: 0,
      }),
      new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y,
        button: 0,
      }),
    ];

    eventSequence.forEach(event => {
      element.dispatchEvent(event);
    });

    return true;
  } catch (err) {
    console.warn('[招聘助手] 模拟点击失败，回退到原生点击:', err.message);
    element.click();
    return true;
  }
}

/**
 * 模拟鼠标移动到目标元素（带随机路径）
 * 生成多个中间点，模拟人类手部移动的贝塞尔曲线
 */
async function simulateMouseMove(targetElement) {
  if (!targetElement) return;

  const targetRect = targetElement.getBoundingClientRect();
  const targetX = targetRect.left + targetRect.width / 2;
  const targetY = targetRect.top + targetRect.height / 2;

  // 起始位置（当前鼠标位置附近，加随机偏移）
  const startX = window.innerWidth / 2 + (Math.random() - 0.5) * 200;
  const startY = window.innerHeight / 2 + (Math.random() - 0.5) * 200;

  // 生成 3-5 个中间控制点
  const numPoints = 3 + Math.floor(Math.random() * 3);
  const points = [];

  for (let i = 1; i <= numPoints; i++) {
    const t = i / (numPoints + 1);
    const x = startX + (targetX - startX) * t + (Math.random() - 0.5) * 80;
    const y = startY + (targetY - startY) * t + (Math.random() - 0.5) * 60;
    points.push({ x, y });
  }

  points.push({ x: targetX, y: targetY });

  // 依次触发 mousemove 事件
  for (const point of points) {
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: point.x, clientY: point.y,
    }));
    await sleep(30 + Math.random() * 50); // 每个点间隔 30-80ms
  }
}

/**
 * 模拟人类滚动行为
 * 随机滚动一段距离，模拟阅读页面
 */
async function simulateHumanScroll() {
  if (!settings.scrollBeforeClick) return;

  const mode = chooseScrollMode();
  if (mode === 'segmented') {
    const segments = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < segments; i++) {
      window.scrollBy({
        top: 60 + Math.random() * 160,
        behavior: 'smooth',
      });
      await sleep(450 + Math.random() * 900);
    }
    return;
  }

  const scrollAmount = mode === 'fast'
    ? 260 + Math.random() * 520
    : mode === 'slow'
    ? 50 + Math.random() * 140
    : 100 + Math.random() * 300;
  const scrollDuration = mode === 'fast'
    ? 180 + Math.random() * 260
    : mode === 'slow'
    ? 900 + Math.random() * 1600
    : 300 + Math.random() * 500;

  window.scrollBy({
    top: Math.random() > 0.2 ? scrollAmount : -scrollAmount * 0.35,
    behavior: 'smooth',
  });

  await sleep(scrollDuration);
}

function chooseScrollMode() {
  const configured = settings.scrollMode || 'mixed';
  if (configured !== 'mixed') return configured;
  const modes = ['slow', 'segmented', 'fast'];
  return modes[Math.floor(Math.random() * modes.length)];
}

/**
 * 模拟页面停留（阅读时间）
 */
async function simulateReadingTime(minMs = 1000, maxMs = 3000) {
  const readingTime = minMs + Math.random() * (maxMs - minMs);
  await sleep(readingTime);
}

async function simulateCandidateDwell() {
  await simulateReadingTime(
    settings.detailDwellMin || settings.candidateDwellMin || 12000,
    settings.detailDwellMax || settings.candidateDwellMax || 30000
  );
}

async function simulateActionDwell() {
  await simulateReadingTime(settings.actionDwellMin || 8000, settings.actionDwellMax || 18000);
}

async function maybeTakeLongBreak(processedCount) {
  const every = Number(settings.longBreakEvery || 0);
  if (!every || processedCount === 0 || processedCount % every !== 0) return;
  notifyPopup('log', {
    message: `已处理 ${processedCount} 位候选人，进入长暂停以降低风控风险`,
    type: 'info',
  });
  await simulateReadingTime(settings.longBreakMin || 60000, settings.longBreakMax || 150000);
}

/**
 * 工具函数：延迟
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 安全控制模块
// ============================================================

/**
 * 检查是否可以执行操作（限速检查）
 */
function canPerformOperation() {
  resetCountersIfNeeded();

  if (!isWithinConfiguredWorkTime()) {
    console.warn('[招聘助手] 当前不在配置的工作时间段内，暂停自动操作');
    notifyPopup('log', {
      message: `⏸ 当前不在工作时间 ${settings.workStartTime || '09:00'}-${settings.workEndTime || '18:00'}，自动操作已暂停`,
      type: 'warning',
    });
    return false;
  }

  // 检查每日上限
  if (operationCount.today >= settings.dailyLimit) {
    console.warn(`[招聘助手] 已达到每日操作上限 (${settings.dailyLimit})，暂停自动操作`);
    notifyPopup('log', {
      message: `⚠️ 已达每日上限 ${settings.dailyLimit} 次，自动接收已暂停`,
      type: 'error',
    });
    return false;
  }

  // 检查每小时上限
  if (operationCount.hourly >= settings.hourlyLimit) {
    console.warn(`[招聘助手] 已达到每小时操作上限 (${settings.hourlyLimit})，暂停自动操作`);
    notifyPopup('log', {
      message: `⚠️ 已达每小时上限 ${settings.hourlyLimit} 次，等待下一小时`,
      type: 'error',
    });
    return false;
  }

  // 检查安全降级状态
  if (safetyState.isDegraded && settings.safeMode) {
    console.warn('[招聘助手] 安全模式已降级，仅执行抓取操作');
    return false;
  }

  // 检查最小操作间隔（至少 3 秒）
  const now = Date.now();
  if (safetyState.lastOperationTime > 0) {
    const elapsed = now - safetyState.lastOperationTime;
    if (elapsed < 3000) {
      console.warn(`[招聘助手] 操作间隔过短 (${elapsed}ms)，跳过`);
      return false;
    }
  }

  return true;
}

function parseTimeToMinutes(value, fallback) {
  const match = String(value || fallback || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}

function isWithinConfiguredWorkTime(now = new Date()) {
  if (!settings.workTimeEnabled) return true;
  const jsDay = now.getDay();
  const day = jsDay === 0 ? 7 : jsDay;
  const allowedDays = Array.isArray(settings.workDays) && settings.workDays.length
    ? settings.workDays.map(Number)
    : [1, 2, 3, 4, 5];
  if (!allowedDays.includes(day)) return false;
  const start = parseTimeToMinutes(settings.workStartTime, '09:00');
  const end = parseTimeToMinutes(settings.workEndTime, '18:00');
  if (start == null || end == null || start === end) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

/**
 * 记录操作
 */
function recordOperation() {
  operationCount.today++;
  operationCount.hourly++;
  safetyState.lastOperationTime = Date.now();
  safetyState.consecutiveErrors = 0;

  // 保存计数到 storage
  chrome.storage.local.set({
    operationCount: {
      ...operationCount,
      timestamp: Date.now(),
    },
  });
}

/**
 * 报告错误（连续错误触发降级）
 */
function reportError(errorMsg) {
  safetyState.consecutiveErrors++;
  console.error(`[招聘助手] 操作错误 (${safetyState.consecutiveErrors}次):`, errorMsg);

  if (safetyState.consecutiveErrors >= 3 && settings.safeMode) {
    triggerSafetyDegradation();
  }
}

/**
 * 触发安全降级
 * 参考 GoodHR v1.3.1：曾因安全考虑禁用自动下载简历功能
 */
function triggerSafetyDegradation() {
  safetyState.isDegraded = true;
  settings.autoAccept = false;

  chrome.storage.local.set({ settings, safetyState });

  console.warn('[招聘助手] 🚨 检测到连续异常，已自动降级为安全模式');
  notifyPopup('log', {
    message: '🚨 连续异常，已自动关闭自动接收（安全降级）',
    type: 'error',
  });
}

/**
 * 概率浏览候选人详情页
 * 参考 GoodHR v1.4：概率查看候选人信息功能
 */
async function probabilisticBrowse(card) {
  if (Math.random() > settings.browseProbability) return;

  const detailLink = card.querySelector('a[href*="geek"]') ||
                    card.querySelector('a[href*="resume"]') ||
                    card.querySelector('a[href*="detail"]');
  if (!detailLink) return;

  console.log('[招聘助手] 概率浏览：查看候选人详情');
  notifyPopup('log', {
    message: '📖 模拟浏览候选人详情页',
    type: 'info',
  });

  // 在新标签页中打开（不影响当前页面操作）
  // 注意：不实际打开，仅模拟鼠标悬停行为
  detailLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(500 + Math.random() * 1000);
  detailLink.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
}

// ============================================================
// MutationObserver - 监听页面变化
// ============================================================

let observer = null;
let observeDebounce = null;

function startObserving() {
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    if (!window.location.hostname.includes('zhipin.com')) return;

    // 防抖：避免短时间内多次触发
    if (observeDebounce) clearTimeout(observeDebounce);
    observeDebounce = setTimeout(() => {
      handlePageChange();
    }, 2000 + Math.random() * 2000); // 2-4秒随机防抖
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  console.log('[招聘助手] 开始监听页面变化（防抖模式）');

  // 首次加载延迟执行
  setTimeout(() => handlePageChange(), 3000 + Math.random() * 2000);
}

// ============================================================
// 页面变化处理
// ============================================================

function handlePageChange() {
  const url = window.location.href;

  if (url.includes('/web/recruit/geek/receive') ||
      url.includes('/web/recruit/geek/deliver')) {
    handleReceivePage();
  }

  if (url.includes('/chat/')) {
    handleChatPage();
  }

  // 候选人浏览只由用户在弹窗中主动触发，避免页面变化导致连续自动操作。
}

// ============================================================
// 简历接收页面处理（安全增强版）
// ============================================================

async function handleReceivePage() {
  const resumeCards = findResumeCards();
  console.log(`[招聘助手] 发现 ${resumeCards.length} 个简历卡片`);

  for (let index = 0; index < resumeCards.length; index++) {
    const card = resumeCards[index];
    const resumeId = extractResumeId(card);
    if (!resumeId || processedResumeIds.has(resumeId)) continue;

    // 1. 抓取简历信息（始终执行，安全操作）
    let resumeInfo = null;
    if (settings.autoScrape) {
      resumeInfo = scrapeResumeInfo(card, resumeId);
      if (resumeInfo) {
        resumeInfo = await enhanceCandidateWithPageIntelligence(resumeInfo, card, 'resume-card');
        await ensureJobRequirementForResume(card, resumeInfo);
        const saveResult = await saveResumeData(resumeInfo);
        if (saveResult.saved) {
          notifyPopup('resumeScraped', resumeInfo);
        }
      }
    }

    // 2. 概率浏览详情页（模拟真人行为）
    await probabilisticBrowse(card);

    // 3. 自动接收（需要通过安全检查）
    if (settings.autoAccept || settings.autoRequestResume) {
      const actionResult = await runResumeActions({
        scope: card,
        contextName: resumeInfo?.name || `第 ${index + 1} 位候选人`,
        manual: false,
        sequenceOffset: index,
      });
      if (actionResult.blockedBySafety) {
        break;
      }
    }

    processedResumeIds.add(resumeId);
  }
}

async function ensureJobRequirementForResume(card, resumeInfo) {
  if (!resumeInfo?.role) return;
  const key = jobRequirementCacheKey(resumeInfo.role, resumeInfo.accountName);
  if (cachedJobRequirements[key]?.requirement) {
    if (looksLikeJobRequirement(cachedJobRequirements[key].requirement)) {
      resumeInfo.jobRequirement = cachedJobRequirements[key].requirement;
      resumeInfo.evaluation = evaluateCandidate(resumeInfo);
      return;
    }
    delete cachedJobRequirements[key];
    chrome.storage.local.set({ jobRequirements: cachedJobRequirements });
  }

  let requirement = extractJobRequirementFromPage(card, resumeInfo.role);
  if (!requirement) {
    requirement = await openJobDetailAndExtractRequirement(card, resumeInfo.role);
  }
  if (requirement) {
    resumeInfo.jobRequirement = requirement;
    cacheJobRequirement(resumeInfo.role, requirement, {
      source: resumeInfo.source,
      accountName: resumeInfo.accountName,
      sourceUrl: resumeInfo.sourceUrl,
    });
    resumeInfo.evaluation = evaluateCandidate(resumeInfo);
    notifyPopup('log', {
      message: `已保存岗位要求：${resumeInfo.role}`,
      type: 'success',
    });
  }
}

async function ensureChatJobRequirement(resumeInfo) {
  if (!resumeInfo?.role) return;
  const key = jobRequirementCacheKey(resumeInfo.role, resumeInfo.accountName);
  if (cachedJobRequirements[key]?.requirement) {
    if (looksLikeJobRequirement(cachedJobRequirements[key].requirement)) {
      resumeInfo.jobRequirement = cachedJobRequirements[key].requirement;
      resumeInfo.evaluation = evaluateCandidate(resumeInfo);
      return;
    }
    delete cachedJobRequirements[key];
    chrome.storage.local.set({ jobRequirements: cachedJobRequirements });
  }

  const backendRequirement = await fetchJobRequirementFromBackend(resumeInfo.role, resumeInfo.accountName);
  if (backendRequirement?.requirement && looksLikeJobRequirement(backendRequirement.requirement)) {
    cacheJobRequirement(resumeInfo.role, backendRequirement.requirement, {
      source: backendRequirement.source || resumeInfo.source,
      accountName: backendRequirement.account_name || backendRequirement.accountName || resumeInfo.accountName,
      sourceUrl: backendRequirement.source_url || resumeInfo.sourceUrl,
    });
    resumeInfo.jobRequirement = backendRequirement.requirement;
    resumeInfo.evaluation = evaluateCandidate(resumeInfo);
    return;
  }

  let requirement = extractJobRequirementFromPage(
    findLikelyJobDetailContainer(resumeInfo.role, document.body),
    resumeInfo.role
  );
  if (!requirement) {
    const trigger = findCommunicationJobTrigger(resumeInfo.role);
    if (trigger && canPerformOperation()) {
      await simulateHumanScroll();
      await simulateMouseMove(trigger);
      await sleep(900 + Math.random() * 1400);
      simulateHumanClick(trigger);
      const startedAt = Date.now();
      while (Date.now() - startedAt < 9000 && !requirement) {
        await sleep(600 + Math.random() * 700);
        await expandCurrentJobDetail(resumeInfo.role);
        requirement = extractJobRequirementFromPage(document.body, resumeInfo.role);
      }
    }
  }

  if (requirement) {
    resumeInfo.jobRequirement = requirement;
    cacheJobRequirement(resumeInfo.role, requirement, {
      source: resumeInfo.source,
      accountName: resumeInfo.accountName,
      sourceUrl: resumeInfo.sourceUrl,
    });
    resumeInfo.evaluation = evaluateCandidate(resumeInfo);
  }
}

async function fetchJobRequirementFromBackend(role, accountName = '') {
  if (!role) return null;
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getJobRequirementFromBackend',
      role,
      accountName,
    });
    return response?.item || null;
  } catch (err) {
    return null;
  }
}

async function openJobDetailAndExtractRequirement(card, role) {
  const trigger = findJobDetailTrigger(card, role);
  if (!trigger || !canPerformOperation()) return '';
  const previousText = normalizeText(document.body.textContent || '');
  await simulateMouseMove(trigger);
  await sleep(500 + Math.random() * 900);
  simulateHumanClick(trigger);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 9000) {
    await sleep(600 + Math.random() * 700);
    await expandCurrentJobDetail(role);
    const requirement = extractJobRequirementFromPage(document.body, role);
    if (requirement && normalizeText(document.body.textContent || '') !== previousText) {
      return requirement;
    }
  }
  return '';
}

async function expandCurrentJobDetail(role = '') {
  const detailContainer = findLikelyJobDetailContainer(role, document.body);
  if (!detailContainer) return false;
  return clickExpandableText(detailContainer, ['展开全部', '查看更多', '展开']);
}

async function clickExpandableText(container, labels = []) {
  const targets = Array.from(container.querySelectorAll('button, a, [role="button"], span, div'))
    .filter(isActionableElement)
    .filter(element => {
      const text = getClickableText(element);
      return labels.some(label => text === label || text.includes(label)) && text.length <= 40;
    })
    .sort((a, b) => getClickableText(a).length - getClickableText(b).length);
  if (!targets.length) return false;
  await simulateMouseMove(targets[0]);
  await sleep(300 + Math.random() * 600);
  const clicked = simulateHumanClick(targets[0]);
  if (clicked) {
    await sleep(800 + Math.random() * 1000);
  }
  return clicked;
}

function findJobDetailTrigger(card, role) {
  const selectors = [
    'a[href*="job_detail"]',
    'a[href*="/job_detail/"]',
    'a[href*="job"]',
    '[class*="job"] a',
    '[class*="position"] a',
    '[class*="job-name"]',
    '[class*="position-name"]',
  ];
  for (const selector of selectors) {
    const el = card.querySelector(selector);
    if (el && isActionableElement(el)) return el;
  }
  const roleText = normalizeText(role || '');
  if (!roleText) return null;
  const roots = [card, document].filter(Boolean);
  for (const root of roots) {
    const elements = Array.from(root.querySelectorAll?.('a, button, span, div, [role="button"]') || []);
    const target = elements
      .filter(isActionableElement)
      .map(el => ({ el, text: normalizeText(el.textContent || '') }))
      .filter(item => item.text.includes(roleText) || (item.text.includes('沟通职位') && item.text.length <= 120))
      .sort((a, b) => a.text.length - b.text.length)[0]?.el;
    if (target) return target;
  }
  return null;
}

// ============================================================
// DOM 查找函数（保持不变）
// ============================================================

function findResumeCards() {
  const selectors = [
    '.resume-list-item',
    '.geek-item',
    '.deliver-item',
    '[class*="resume"]',
    '[class*="geek-list"] > [class*="item"]',
    '[class*="deliver"] [class*="item"]',
    '[class*="candidate"] [class*="card"]',
    '.job-card-wrapper',
    '.search-job-result li',
    '.list-job-card',
  ];

  for (const selector of selectors) {
    const cards = document.querySelectorAll(selector);
    if (cards.length > 0) {
      return Array.from(cards);
    }
  }

  const acceptButtons = document.querySelectorAll(
    'button, [role="button"], a, span, div'
  );
  const cardContainers = new Set();

  acceptButtons.forEach(btn => {
    const text = (btn.textContent || '').trim();
    if (text === '同意' || text === '接收' || text === '查看简历') {
      let container = btn.closest('[class*="item"]') ||
                      btn.closest('[class*="card"]') ||
                      btn.closest('[class*="row"]') ||
                      btn.closest('li') ||
                      btn.parentElement?.parentElement;
      if (container) {
        cardContainers.add(container);
      }
    }
  });

  return Array.from(cardContainers);
}

function findAcceptButton(card) {
  const target = findActionTargets(card).find(item => item.type === 'accept');
  return target?.button || null;
}

function findActionTargets(scope = document) {
  const panel = scope === document ? findWorkbenchConversationPanel() : scope;
  const roots = panel === document ? [document] : [panel || document];
  const targets = [];
  const seen = new Set();

  roots.forEach(root => {
    const clickable = root.querySelectorAll('button, a, [role="button"], span, div');
    clickable.forEach(element => {
      if (!isActionableElement(element)) return;

      const text = getClickableText(element);
      const actionType = matchResumeAction(text, element);
      if (!actionType) return;

      const actionKey = getActionKey(actionType, element, text);
      if (seen.has(actionKey)) return;
      seen.add(actionKey);

      targets.push({
        type: actionType,
        label: RESUME_ACTIONS[actionType].label,
        button: element,
        text,
        key: actionKey,
      });
    });
  });

  return targets.sort((a, b) => scoreResumeActionTarget(b) - scoreResumeActionTarget(a));
}

function scoreResumeActionTarget(target) {
  const rect = target.button.getBoundingClientRect();
  let score = 0;
  if (/^(同意|接收|求简历|索要简历|请求简历)$/.test(target.text)) score += 8;
  if (target.button.tagName && /button/i.test(target.button.tagName)) score += 3;
  if (target.type === 'request' && rect.top > window.innerHeight * 0.55) score += 4;
  if (target.type === 'accept' && rect.top > window.innerHeight * 0.25) score += 2;
  if (rect.width >= 48 && rect.width <= 180) score += 2;
  if (target.text.length > 20) score -= 4;
  return score;
}

function isActionableElement(element) {
  if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getElementText(element) {
  return normalizeText(element?.innerText || element?.textContent || '');
}

function rectInside(inner, outer, tolerance = 8) {
  if (!inner || !outer) return false;
  return inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.bottom <= outer.bottom + tolerance;
}

function containsElement(container, element) {
  if (!container || !element) return false;
  return container === element || container.contains(element);
}

function findWorkbenchCandidateListPanel() {
  const candidates = Array.from(document.querySelectorAll('section, aside, article, div, ul'))
    .filter(isActionableElement)
    .map(element => {
      const text = getElementText(element);
      const rect = element.getBoundingClientRect();
      let score = 0;
      if (/全部职位/.test(text)) score += 5;
      if (/未读/.test(text)) score += 3;
      if (/批量/.test(text)) score += 2;
      if (/\d{1,2}:\d{2}/.test(text)) score += 3;
      if ((text.match(/\(J\d+\)/g) || []).length >= 3) score += 6;
      if (rect.height > window.innerHeight * 0.45) score += 2;
      if (rect.width >= 240 && rect.width <= 520) score += 2;
      if (WORKBENCH_TEXT.sidebarNoise.test(text)) score -= 8;
      return { element, text, rect, score };
    })
    .filter(item => item.score >= 7 && item.text.length >= 80 && item.text.length <= 12000)
    .sort((a, b) => b.score - a.score || a.rect.left - b.rect.left || a.text.length - b.text.length);
  return candidates[0]?.element || null;
}

function findWorkbenchConversationPanel() {
  const listPanel = findWorkbenchCandidateListPanel();
  const listRect = listPanel?.getBoundingClientRect();
  const candidates = Array.from(document.querySelectorAll('main, section, article, div, [class*="chat"], [class*="conversation"], [class*="im"]'))
    .filter(isActionableElement)
    .map(element => {
      const text = getElementText(element);
      const rect = element.getBoundingClientRect();
      let score = 0;
      if (/沟通职位/.test(text)) score += 6;
      if (/在线简历/.test(text)) score += 5;
      if (/求简历|换电话|换微信|约面试|不合适/.test(text)) score += 4;
      if (/牛人分析器|刚刚活跃|期望/.test(text)) score += 3;
      if (listRect && rect.left >= listRect.right - 20) score += 3;
      if (rect.width > 520 && rect.height > window.innerHeight * 0.45) score += 2;
      if (WORKBENCH_TEXT.sidebarNoise.test(text) && !/沟通职位/.test(text)) score -= 8;
      if (/全部职位/.test(text) && /批量/.test(text)) score -= 4;
      return { element, text, rect, score };
    })
    .filter(item => item.score >= 8 && item.text.length >= 80 && item.text.length <= 30000)
    .sort((a, b) => b.score - a.score || b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  return candidates[0]?.element || document.body;
}

function findElementsInWorkbenchScope(scope, selector) {
  const root = scope && scope !== document ? scope : findWorkbenchConversationPanel();
  return Array.from(root?.querySelectorAll?.(selector) || document.querySelectorAll(selector));
}

function getClickableText(element) {
  return normalizeText([
    element.textContent,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-title'),
  ].filter(Boolean).join(' '));
}

function matchResumeAction(text, element) {
  if (!text || text.length > 80) return null;

  for (const [type, config] of Object.entries(RESUME_ACTIONS)) {
    if (config.blockedKeywords.some(keyword => text.includes(keyword))) {
      continue;
    }
    if (config.keywords.some(keyword => text === keyword || text.includes(keyword))) {
      return type;
    }
  }

  return null;
}

function findCommunicationJobTrigger(role = '') {
  const roleText = normalizeText(role || '');
  const panel = findWorkbenchConversationPanel();
  const candidates = findElementsInWorkbenchScope(panel, 'button, a, [role="button"], [class*="job"], [class*="position"], [class*="chat"], div, span')
    .filter(isActionableElement)
    .map(element => {
      const text = getElementText(element);
      const rect = element.getBoundingClientRect();
      let score = 0;
      if (/沟通职位/.test(text)) score += 8;
      if (roleText && text.includes(roleText)) score += 6;
      if (/\(J\d+\)|J\d+/.test(text)) score += 3;
      if (text.length <= 90) score += 2;
      if (rect.top < window.innerHeight * 0.35) score += 2;
      if (/您好|BOSS|求简历|在线简历|附件简历/.test(text)) score -= 6;
      return { element, text, score };
    })
    .filter(item => item.score >= 8 && item.text.length > 0 && item.text.length <= 140)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  return candidates[0]?.element || null;
}

function getActionKey(type, element, text) {
  const rect = element.getBoundingClientRect();
  const path = window.location.pathname;
  const position = `${Math.round(rect.left)}_${Math.round(rect.top)}_${Math.round(rect.width)}_${Math.round(rect.height)}`;
  return `${type}_${hashString(`${path}|${text}|${position}`)}`;
}

function getActiveConversationText() {
  const panel = findCandidateSummaryPanel();
  if (!panel) return '';
  const rect = panel.getBoundingClientRect();
  const visibleText = Array.from(document.querySelectorAll('section, article, div, [class*="chat"], [class*="message"]'))
    .filter(isActionableElement)
    .map(element => {
      const itemRect = element.getBoundingClientRect();
      const text = normalizeText(element.innerText || element.textContent || '');
      return { text, rect: itemRect };
    })
    .filter(item => item.text && item.text.length <= 3000 && item.rect.left >= rect.left - 80 && item.rect.top >= rect.top - 120)
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    .map(item => item.text)
    .join(' ');
  return normalizeText(`${panel.textContent || ''} ${visibleText}`).slice(0, 5000);
}

function findExistingResumeRequestStatus(scopeText = '') {
  const text = normalizeText(scopeText || getActiveConversationText());
  if (/已索要|已请求|已求简历|等待对方.*简历|简历.*等待对方/.test(text)) {
    return '已索要简历';
  }
  if (text.includes(RESUME_REQUEST_FALLBACK_MESSAGE)) {
    return '已发送求简历消息';
  }
  return '';
}

async function closeResumeOverlayIfPresent() {
  const before = normalizeText(document.body.textContent || '').slice(0, 700);
  const closeTarget = Array.from(document.querySelectorAll('button, a, [role="button"], span, div')).find((element) => {
    if (!isActionableElement(element)) return false;
    const text = getClickableText(element);
    if (!text || text.length > 20) return false;
    return /^(关闭|返回|收起|取消|×|x)$/i.test(text);
  });
  if (closeTarget) {
    await simulateMouseMove(closeTarget);
    await sleep(400 + Math.random() * 600);
    simulateHumanClick(closeTarget);
    await sleep(900 + Math.random() * 1200);
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
  await sleep(700 + Math.random() * 900);
  return normalizeText(document.body.textContent || '').slice(0, 700) !== before;
}

async function prepareCommunicationActionsForRequest() {
  const panel = findWorkbenchConversationPanel();
  const input = panel?.querySelector?.('textarea, input[type="text"], [contenteditable="true"], [class*="input"], [class*="editor"]') ||
    document.querySelector('textarea, input[type="text"], [contenteditable="true"], [class*="input"], [class*="editor"]');
  if (input?.scrollIntoView) {
    input.scrollIntoView({ block: 'center', inline: 'nearest' });
    await sleep(500 + Math.random() * 700);
  }
}

function isLikelyChatInput(element) {
  if (!isActionableElement(element)) return false;
  const tag = element.tagName.toLowerCase();
  const editable = element.getAttribute('contenteditable') === 'true';
  const type = String(element.getAttribute('type') || '').toLowerCase();
  if (!editable && tag !== 'textarea' && !(tag === 'input' && (!type || type === 'text'))) return false;

  const hint = normalizeText([
    element.getAttribute('placeholder'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.className,
  ].filter(Boolean).join(' '));
  if (/搜索|筛选|职位|岗位|账号|姓名|手机号|电话|验证码|邮箱/.test(hint)) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width < 160 || rect.height < 20) return false;
  return rect.bottom > window.innerHeight * 0.45;
}

function findChatMessageInput() {
  const panel = findWorkbenchConversationPanel();
  const roots = panel && panel !== document.body ? [panel, document.body] : [document.body];
  const inputs = roots.flatMap(root => Array.from(root.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')))
    .filter(isLikelyChatInput)
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bRect.bottom - aRect.bottom || bRect.width - aRect.width;
    });
  return inputs[0] || null;
}

function findChatSendButton(input) {
  const inputRect = input.getBoundingClientRect();
  const roots = [];
  let current = input.parentElement;
  while (current && roots.length < 5) {
    roots.push(current);
    current = current.parentElement;
  }
  roots.push(document.body);

  const candidates = [];
  roots.forEach(root => {
    root.querySelectorAll('button, a, [role="button"], span, div').forEach(element => {
      if (!isActionableElement(element)) return;
      const text = getClickableText(element);
      if (!/^(发送|发送消息)$/.test(text)) return;
      if (/附件|简历|微信|电话|面试|交换/.test(text)) return;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < inputRect.top - 80) return;
      candidates.push({
        element,
        distance: Math.abs(rect.left - inputRect.right) + Math.abs(rect.top - inputRect.top),
      });
    });
  });

  return candidates.sort((a, b) => a.distance - b.distance)[0]?.element || null;
}

function setChatInputValue(input, message) {
  input.focus();
  if (input.getAttribute('contenteditable') === 'true') {
    input.textContent = message;
  } else {
    const prototype = input.tagName.toLowerCase() === 'textarea'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(input, message);
    else input.value = message;
  }

  input.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: message,
  }));
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: message,
  }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function getChatInputText(input) {
  if (!input) return '';
  if (input.getAttribute('contenteditable') === 'true') {
    return normalizeText(input.textContent || '');
  }
  return normalizeText(input.value || '');
}

async function sendResumeRequestFallbackMessage(contextName = '候选人', reason = '', contextKey = '') {
  const summary = {
    executed: 0,
    skipped: 0,
    reason: '',
    targetText: `兜底消息：${RESUME_REQUEST_FALLBACK_MESSAGE}`,
    viaMessage: true,
    messageText: RESUME_REQUEST_FALLBACK_MESSAGE,
  };
  if (!canPerformOperation()) {
    return { ...summary, blockedBySafety: true, reason: '安全策略限制操作' };
  }

  await closeResumeOverlayIfPresent();
  await prepareCommunicationActionsForRequest();
  const input = findChatMessageInput();
  if (!input) {
    return { ...summary, skipped: 1, reason: '未找到聊天输入框' };
  }

  const actionKey = `request_message_${hashString(`${window.location.pathname}|${contextKey || contextName}|${RESUME_REQUEST_FALLBACK_MESSAGE}`)}`;
  if (processedActionKeys.has(actionKey) || findExistingResumeRequestStatus()) {
    return { ...summary, executed: 1, alreadyRequested: true, reason: '已发送求简历消息' };
  }

  await sleep(humanDelay());
  await simulateHumanScroll();
  await simulateActionDwell();
  await simulateMouseMove(input);
  await sleep(500 + Math.random() * 900);
  simulateHumanClick(input);
  setChatInputValue(input, RESUME_REQUEST_FALLBACK_MESSAGE);
  await sleep(600 + Math.random() * 900);

  const sendButton = findChatSendButton(input);
  let sent = false;
  if (sendButton) {
    await simulateMouseMove(sendButton);
    await sleep(500 + Math.random() * 900);
    sent = simulateHumanClick(sendButton);
  } else {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    sent = true;
  }
  await sleep(900 + Math.random() * 900);
  if (document.contains(input) && getChatInputText(input).includes(RESUME_REQUEST_FALLBACK_MESSAGE)) {
    sent = false;
  }

  if (!sent) {
    return { ...summary, skipped: 1, reason: '求简历兜底消息发送失败' };
  }

  processedActionKeys.add(actionKey);
  recordOperation();
  notifyPopup('resumeActionExecuted', {
    name: contextName,
    actionType: 'request',
    actionLabel: '发送求简历消息',
  });
  await simulateActionDwell();
  return {
    ...summary,
    executed: 1,
    reason: reason ? `未点击到求简历按钮，已发送兜底消息：${reason}` : '未点击到求简历按钮，已发送兜底消息',
  };
}

function findCandidateNavigationTargets() {
  const listPanel = findWorkbenchCandidateListPanel();
  const roots = listPanel ? [listPanel] : [document];
  const selectors = [
    '.geek-item',
    '.resume-list-item',
    '.deliver-item',
    '[class*="geek-list"] > [class*="item"]',
    '[class*="candidate"] [class*="card"]',
    '[class*="recommend"] [class*="item"]',
    '[class*="list"] [class*="item"]',
    '.job-card-wrapper',
    '.search-job-result li',
    '.list-job-card',
  ];
  const targets = [];
  const seen = new Set();

  roots.forEach(root => {
    selectors.forEach(selector => {
      root.querySelectorAll(selector).forEach(card => {
      if (!isActionableElement(card)) return;
      const text = normalizeText(card.textContent || '');
      if (!text || text.length < 2) return;
      if (/^(同意|接收|接收简历|索要简历|请求简历)$/.test(text)) return;
      if (!isLikelyCandidateListItemText(text)) return;
      if (listPanel && !containsElement(listPanel, card)) return;

      const clickable = findCardClickable(card);
      if (!clickable) return;

      const key = getCandidateBrowseKey(card, clickable);
      if (seen.has(key) || processedBrowseKeys.has(key)) return;
      seen.add(key);

      targets.push({
        card,
        clickable,
        key,
        name: extractCandidateName(card),
      });
    });
  });
  });

  return targets;
}

function isLikelyCandidateListItemText(text) {
  if (!text || text.length < 8 || text.length > 360) return false;
  if (WORKBENCH_TEXT.sidebarNoise.test(text)) return false;
  if (/心仪牛人不回应|顾问帮您打电话/.test(text)) return false;
  const hasRole = WORKBENCH_TEXT.candidateListSignal.test(text);
  const hasChatSnippet = /您好|你好|Boss|BOSS|面试官|刚刚|希望|可以|方便/.test(text);
  const hasTime = /\d{1,2}:\d{2}/.test(text);
  const hasName = Boolean(extractCandidateNameFromText(text));
  return hasName && (hasRole || hasChatSnippet || hasTime);
}

function findCardClickable(card) {
  const link = card.querySelector('a[href*="geek"], a[href*="resume"], a[href*="chat"], a[href*="detail"]');
  if (link && isActionableElement(link)) return link;

  const preferred = card.querySelector('[class*="name"], [class*="title"], [class*="geek-name"], h3, h4');
  if (preferred && isActionableElement(preferred)) return preferred;

  return card;
}

function extractCandidateName(card) {
  return extractCandidateNameFromText(card?.textContent || '') || cleanCandidateName(extractText(card, [
    '[class*="name"]',
    '[class*="title"]',
    '[class*="geek-name"]',
    'h3',
    'h4',
  ])) || '候选人';
}

function getCandidateBrowseKey(card, clickable) {
  const href = clickable.href || '';
  const text = normalizeText(card.textContent || '').slice(0, 180);
  const rect = card.getBoundingClientRect();
  const position = `${Math.round(rect.left)}_${Math.round(rect.top)}`;
  return `browse_${hashString(`${window.location.pathname}|${href}|${text}|${position}`)}`;
}

async function waitForCommunicationInterface(previousUrl, previousText) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    await sleep(350);
    const currentText = normalizeText(document.body.textContent || '').slice(0, 500);
    if (window.location.href !== previousUrl) return true;
    if (currentText && currentText !== previousText) return true;
    if (findActionTargets(document).length > 0) return true;
  }
  return false;
}

function extractResumeId(card) {
  const dataId = card.getAttribute('data-id') ||
                 card.getAttribute('data-geek-id') ||
                 card.getAttribute('data-resume-id') ||
                 card.getAttribute('data-encrypt-id');
  if (dataId) return dataId;

  const link = card.querySelector('a[href*="geek"]') ||
               card.querySelector('a[href*="resume"]');
  if (link) {
    const match = link.href.match(/\/(\w{10,})/);
    if (match) return match[1];
  }

  const allCards = findResumeCards();
  const index = allCards.indexOf(card);
  const stableText = normalizeText(card.textContent || '').slice(0, 240);
  return `card_${index}_${hashString(`${window.location.pathname}|${stableText}`)}`;
}

// ============================================================
// 简历信息抓取（保持不变）
// ============================================================

function scrapeResumeInfo(card, resumeId) {
  try {
    const info = {
      id: resumeId,
      source: 'BOSS直聘',
      sourceUrl: window.location.href,
      receivedDate: new Date().toISOString().split('T')[0],
      receivedTime: new Date().toISOString(),
      scrapedAt: new Date().toISOString(),
      accountName: settings.accountName || detectRecruiterAccountInfo().name || '',
      accountPlatform: settings.accountPlatform || 'BOSS直聘',
      hasResume: true,
      hasAttachmentResume: false,
      resumeAttachmentType: 'none',
      resumeStatus: '无附件简历（在线简历）',
    };
    const topLevelText = extractCandidateTopLevelText(card) || cleanCandidateTopLevelText(card.textContent || '');
    info.topLevelText = topLevelText;
    info.rawText = topLevelText;

    info.name = cleanCandidateName(extractText(card, [
      '[class*="name"]', '[class*="title"]', '[class*="geek-name"]',
      'h3', 'h4', 'a[class*="name"]',
    ])) || extractCandidateNameFromText(topLevelText) || extractCandidateNameFromText(card.textContent || '');
    info.role = extractText(card, [
      '[class*="job"]', '[class*="position"]',
      '[class*="expect"]', '[class*="intention"]',
    ]);
    const roleKey = jobRequirementCacheKey(info.role, info.accountName);
    info.jobRequirement = cachedJobRequirements[roleKey]?.requirement || extractJobRequirementFromPage(card, info.role);
    if (info.role && info.jobRequirement) {
      cacheJobRequirement(info.role, info.jobRequirement, {
        source: info.source,
        accountName: info.accountName,
        sourceUrl: info.sourceUrl,
      });
    }
    info.education = extractText(card, [
      '[class*="edu"]', '[class*="degree"]', '[class*="education"]',
    ]) || extractEducationFromText(topLevelText);
    info.experience = extractText(card, [
      '[class*="exp"]', '[class*="experience"]', '[class*="work"]',
    ]) || extractExperienceFromText(topLevelText);
    info.ageGender = extractText(card, [
      '[class*="age"]', '[class*="gender"]', '[class*="basic"]',
    ]) || extractAgeFromText(topLevelText);
    info.currentCompany = extractText(card, [
      '[class*="company"]', '[class*="corp"]',
    ]);
    info.expectedSalary = extractText(card, [
      '[class*="salary"]', '[class*="pay"]',
    ]) || extractExpectedSalaryFromText(topLevelText);
    info.status = extractText(card, [
      '[class*="status"]', '[class*="active"]', '[class*="state"]',
    ]);
    info.summary = extractText(card, [
      '[class*="summary"]', '[class*="desc"]',
      '[class*="intro"]', '[class*="self"]',
    ]) || topLevelText;
    info.email = extractByRegex(topLevelText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    info.phone = extractByRegex(topLevelText, /(?:\+?86[-\s]?)?1[3-9]\d{9}/);
    if (!info.name) {
      info.name = extractCandidateNameFromText(info.summary) || extractCandidateNameFromText(info.rawText);
    }

    if (!info.name) {
      console.warn('[招聘助手] 无法提取简历姓名，跳过');
      return null;
    }

    info.qualityScore = calculateResumeQuality(info);
    info.evaluation = evaluateCandidate(info);

    console.log('[招聘助手] 抓取到简历信息:', info.name, info.role);
    return info;

  } catch (err) {
    console.error('[招聘助手] 抓取简历信息失败:', err);
    return null;
  }
}

function normalizeRoleKey(role) {
  return normalizeText(role || '').toLowerCase().replace(/\s+/g, '');
}

function normalizeAccountKey(accountName) {
  return normalizeText(accountName || '').toLowerCase().replace(/\s+/g, '');
}

function jobRequirementCacheKey(role, accountName = '') {
  return normalizeRoleKey(role);
}

function dedupeCachedJobRequirements(items = {}) {
  const deduped = {};
  Object.values(items || {}).forEach((item) => {
    if (!item?.role || !item?.requirement || !looksLikeJobRequirement(item.requirement, item.role)) return;
    const key = jobRequirementCacheKey(item.role);
    const existing = deduped[key];
    const existingLength = normalizeText(existing?.requirement || '').length;
    const nextLength = normalizeText(item.requirement || '').length;
    if (!existing || nextLength > existingLength || String(item.updatedAt || '') > String(existing.updatedAt || '')) {
      deduped[key] = { ...item, accountName: item.accountName || '' };
    }
  });
  return deduped;
}

function cacheJobRequirement(role, requirement, meta = {}) {
  const key = jobRequirementCacheKey(role);
  if (!key || !requirement || requirement.length < 20) return;
  const cleanedRequirement = extractStructuredJobRequirementText(requirement, role);
  if (!looksLikeJobRequirement(cleanedRequirement, role)) return;
  const existing = cachedJobRequirements[key];
  if (existing && existing.requirement && existing.requirement.length >= cleanedRequirement.length) return;
  const item = {
    role,
    requirement: cleanedRequirement.slice(0, 12000),
    source: meta.source || 'BOSS直聘',
    accountName: meta.accountName || '',
    sourceUrl: meta.sourceUrl || window.location.href,
    updatedAt: new Date().toISOString(),
  };
  cachedJobRequirements[key] = item;
  chrome.storage.local.set({ jobRequirements: cachedJobRequirements });
  chrome.runtime.sendMessage({
    action: 'syncJobRequirementToBackend',
    jobRequirement: item,
  }).catch(() => {});
}

function extractJobRequirementFromPage(card, role) {
  const detailContainer = findLikelyJobDetailContainer(role, card);
  const detailText = extractStructuredJobRequirementText(detailContainer, role);
  if (detailText) return detailText;

  const selectors = [
    '[class*="job-sec"]',
    '[class*="job-primary"]',
    '[class*="job-box"]',
    '[class*="job-detail"]',
    '[class*="job-desc"]',
    '[class*="job-require"]',
    '[class*="requirement"]',
    '[class*="position-detail"]',
    '[class*="detail-content"]',
    '[class*="jd"]',
  ];
  for (const selector of selectors) {
    try {
      const scoped = card?.querySelector ? card.querySelector(selector) : null;
      const fallback = (card === document.body || card === document) ? document.querySelector(selector) : null;
      const extracted = extractStructuredJobRequirementText(scoped || fallback, role);
      if (extracted) return extracted;
    } catch (e) {}
  }

  const scoped = extractStructuredJobRequirementText(card, role);
  if (scoped) return scoped;

  const bodyText = normalizeText(document.body.textContent || '');
  const roleText = normalizeText(role || '');
  if (!roleText || !bodyText.includes(roleText)) return '';
  const roleIndex = bodyText.indexOf(roleText);
  const windowText = bodyText.slice(Math.max(0, roleIndex - 500), roleIndex + 3500);
  return extractStructuredJobRequirementText(windowText, role);
}

function extractStructuredJobRequirementText(source, role = '') {
  if (!source) return '';
  const rawText = typeof source === 'string'
    ? source
    : (source.innerText || source.textContent || '');
  let text = normalizeText(rawText);
  if (!text || text.length < 40) return '';
  const hasResumeMarkers = /(工作经历|项目经验|项目经历|教育经历|期望职位|求职期望)/.test(text);
  const hasJobDetailMarkers = /(职位详情|职位描述|职位职责|任职要求|任职资格|岗位要求|职位要求|薪资详情|工作地址|职位发布)/.test(text);
  if (hasResumeMarkers && !hasJobDetailMarkers) return '';
  text = text.replace(/(工作内容|工作职责|岗位职责|职位职责|职位描述|职位介绍|工作要求|任职要求|任职资格|岗位要求|职位要求)/g, ' $1 ');

  const content = extractJobTextSection(text, ['工作内容', '工作职责', '岗位职责', '职位职责', '职位描述', '职位介绍'], [
    '工作要求', '任职要求', '任职资格', '岗位要求', '职位要求',
    ...JOB_REQUIREMENT_STOP_MARKERS,
  ]);
  const requirement = extractJobTextSection(text, ['工作要求', '任职要求', '任职资格', '岗位要求', '职位要求'], JOB_REQUIREMENT_STOP_MARKERS);
  const sections = [content, requirement].filter(Boolean);
  if (!sections.length) return '';

  const result = sections.join('\n').slice(0, 12000).trim();
  if (!looksLikeJobRequirement(result, role)) return '';
  if (isPollutedJobRequirementText(result, role)) return '';
  return result;
}

const JOB_REQUIREMENT_STOP_MARKERS = [
  '薪资详情', '职位福利', '工作地点', '工作地址', '职位发布', '公司介绍', '工商信息', '竞争力分析',
  '相似职位', '推荐职位', '沟通职位', '立即沟通', '在线沟通', '全部职位',
  '新招呼', '沟通中', '账号权益', '招聘规范', '我的客服', '招聘数据',
];

function extractJobTextSection(text, startTitles, stopTitles) {
  const start = findPreferredMarker(text, startTitles, 0);
  if (!start) return '';
  const contentStart = start.index + start.title.length;
  const stop = findEarliestMarker(text, stopTitles, contentStart);
  const end = stop ? stop.index : Math.min(text.length, contentStart + 2600);
  const body = text.slice(contentStart, end).replace(/^[：:，,\s-]+/, '').trim();
  if (body.length < 20) return '';
  return `${start.title}：${body}`.slice(0, 3000);
}

function findPreferredMarker(text, markers, fromIndex = 0) {
  for (const title of markers) {
    const index = text.indexOf(title, fromIndex);
    if (index >= 0) return { title, index };
  }
  return null;
}

function findEarliestMarker(text, markers, fromIndex = 0) {
  return markers
    .map(title => ({ title, index: text.indexOf(title, fromIndex) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0] || null;
}

function isPollutedJobRequirementText(text, role = '') {
  const normalized = normalizeText(text || '');
  const pageMarkers = ['新招呼', '沟通中', '全部职位', '账号权益', '招聘规范', '推荐牛人', '招聘数据']
    .filter(marker => normalized.includes(marker)).length;
  const chatMarkers = [
    'BOSS您好', 'Boss，您好', '您好，我叫', '您好，我是', '您好！我是', '你好，我是',
    '方便沟通', '进一步沟通', '期待进一步', '我的简历', '详细简历',
    '完全匹配', '挺适合', '对贵公司', '对贵岗位', '方便发一份您的简历',
  ]
    .filter(marker => normalized.includes(marker)).length;
  const repeatedRoles = new Set(normalized.match(/[\u4e00-\u9fa5A-Za-z/+-]+(?:工程师|分析|开发|产品|运营)[^\s，。|]{0,18}\(J\d+\)/g) || []).size;
  return pageMarkers >= 1 || chatMarkers >= 1 || repeatedRoles >= 2;
}

function findLikelyJobDetailContainer(role = '', scope = document) {
  const roleText = normalizeText(role || '');
  const documentRoots = Array.from(document.querySelectorAll([
    '[role="dialog"]',
    '[class*="dialog"]',
    '[class*="modal"]',
    '[class*="drawer"]',
    '[class*="popup"]',
    '[class*="job-detail"]',
    '[class*="job-primary"]',
    '[class*="job-sec"]',
    '[class*="detail-content"]',
    'section',
    'article',
  ].join(',')));
  const scopedRoots = scope?.querySelectorAll
    ? Array.from(scope.querySelectorAll('section, article, [class*="job"], [class*="detail"]'))
    : [];
  return [...documentRoots, ...scopedRoots]
    .filter(isActionableElement)
    .map(element => {
      const text = normalizeText(element.innerText || element.textContent || '');
      const hasContent = /(工作内容|工作职责|岗位职责|职位职责|职位描述|职位介绍)/.test(text);
      const hasRequirement = /(工作要求|任职要求|任职资格|职位要求|岗位要求)/.test(text);
      const hasGenericRequirement = /岗位要求/.test(text) && (hasContent || hasRequirement);
      const hasResumeMarkers = /(工作经历|项目经验|项目经历|教育经历|期望职位|求职期望)/.test(text);
      const hasJobDetailMarkers = /(职位详情|职位描述|职位职责|任职要求|任职资格|岗位要求|职位要求|薪资详情|工作地址|职位发布)/.test(text);
      const roleScore = roleText && text.includes(roleText) ? 3 : 0;
      const sectionScore = (hasContent ? 4 : 0) + (hasRequirement ? 4 : 0) + (hasGenericRequirement ? 1 : 0);
      const resumePenalty = hasResumeMarkers && !hasJobDetailMarkers ? 8 : 0;
      return { element, text, score: roleScore + sectionScore - resumePenalty };
    })
    .filter(item => item.score >= 4 && item.text.length >= 40 && item.text.length <= 16000 && !isPollutedJobRequirementText(item.text, role))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0]?.element || null;
}

function extractTextLong(container, selectors, options = {}) {
  for (const selector of selectors) {
    try {
      const scoped = container?.querySelector ? container.querySelector(selector) : null;
      const el = scoped || (options.includeDocumentFallback ? document.querySelector(selector) : null);
      if (el) {
        const text = normalizeText(el.textContent || '');
        if (text && text.length >= 40 && text.length < 12000) {
          return text;
        }
      }
    } catch (e) {}
  }
  return '';
}

function looksLikeJobRequirement(text, role = '') {
  if (!text || text.length < 40) return false;
  if (isPollutedJobRequirementText(text, role)) {
    return false;
  }
  const hasContent = /(工作内容|工作职责|岗位职责|职位职责|职位描述|职位介绍)/.test(text);
  const hasRequirement = /(工作要求|任职要求|任职资格|岗位要求|职位要求)/.test(text);
  return hasContent || hasRequirement;
}

function extractText(container, selectors) {
  for (const selector of selectors) {
    try {
      const el = container.querySelector(selector);
      if (el) {
        const text = (el.textContent || '').trim();
        if (text && text.length > 0 && text.length < 200) {
          return text;
        }
      }
    } catch (e) {}
  }
  return '';
}

function extractByRegex(text, regex) {
  const match = text.match(regex);
  return match ? match[0] : '';
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanCandidateTopLevelText(text) {
  let normalized = normalizeText(text || '');
  const stopMarkers = [
    '工作经历', '项目经历', '教育经历', '资格证书', '证书', '求职期望',
    '沟通记录', '聊天记录', '全部职位', '新招呼', '沟通中', '账号权益',
    '招聘规范', '职位管理', '推荐牛人', '批量',
  ];
  for (const marker of stopMarkers) {
    const index = normalized.indexOf(marker);
    if (index > 8) normalized = normalized.slice(0, index);
  }
  return normalized.slice(0, 900).trim();
}

function isPollutedCandidateText(text) {
  const normalized = normalizeText(text || '');
  const pageMarkers = ['全部职位', '新招呼', '沟通中', '账号权益', '招聘规范', '职位管理']
    .filter(marker => normalized.includes(marker)).length;
  const repeatedRoles = new Set(normalized.match(/[\u4e00-\u9fa5A-Za-z/+-]+(?:工程师|分析|开发|产品|运营)[^\s，。|]{0,18}\(J\d+\)/g) || []).size;
  return pageMarkers >= 2 || repeatedRoles >= 3 || normalized.length > 1200;
}

function scoreCandidateTopLevelText(text, rect, nameText = '') {
  let score = 0;
  if (nameText && text.includes(nameText)) score += 12;
  if (/本科|大专|硕士|博士/.test(text)) score += 8;
  if (/\d{1,2}\s*年|应届|实习/.test(text)) score += 6;
  if (/\d{2}\s*岁/.test(text)) score += 4;
  if (/J\d+|沟通职位|期望/.test(text)) score += 4;
  if (rect.width >= 300) score += 3;
  if (text.length >= 80 && text.length <= 420) score += 3;
  return score;
}

function extractCandidateTopLevelText(scope = document, candidateName = '') {
  const roots = scope === document
    ? Array.from(document.querySelectorAll('header, section, article, [class*="resume"], [class*="geek"], [class*="profile"], [class*="user"], [class*="detail"], [class*="card"], [class*="drawer"], [class*="modal"]'))
    : [scope, ...Array.from(scope.querySelectorAll?.('header, section, article, [class*="resume"], [class*="geek"], [class*="profile"], [class*="user"], [class*="detail"], [class*="card"]') || [])];
  const nameText = normalizeText(candidateName || '');
  const candidates = roots
    .filter(isActionableElement)
    .map(element => {
      const text = cleanCandidateTopLevelText(element.textContent || '');
      const rect = element.getBoundingClientRect();
      return { element, text, rect, score: scoreCandidateTopLevelText(text, rect, nameText) };
    })
    .filter(({ text, rect }) => {
      if (!text || text.length < 12 || text.length > 900) return false;
      if (rect.width < 160 || rect.height < 35) return false;
      if (isPollutedCandidateText(text)) return false;
      if (nameText && !text.includes(nameText) && scope === document) return false;
      return /(在线|离线|岁|年|本科|大专|硕士|博士|J\d+|沟通职位)/.test(text);
    })
    .sort((a, b) => {
      const aName = nameText && a.text.includes(nameText) ? 0 : 1;
      const bName = nameText && b.text.includes(nameText) ? 0 : 1;
      return (aName - bName) || (b.score - a.score) || (a.text.length - b.text.length) || (a.rect.top - b.rect.top);
    });
  return candidates[0]?.text || '';
}

function collectVisibleTextBlocks(limit = 80) {
  return Array.from(document.querySelectorAll('section, header, article, [class*="card"], [class*="geek"], [class*="resume"], [class*="profile"], [class*="job"], [class*="chat"], li, div, span'))
    .filter(isActionableElement)
    .map(element => {
      const rect = element.getBoundingClientRect();
      const text = normalizeText(element.innerText || element.textContent || '');
      return {
        text,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    })
    .filter(item => item.text.length >= 8 && item.text.length <= 600 && item.w >= 80 && item.h >= 12)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.text.length - b.text.length)
    .slice(0, limit);
}

function buildPageIntelligencePayload(candidate = {}, scope = document, task = 'candidate-extract') {
  const panelText = scope?.textContent ? cleanCandidateTopLevelText(scope.textContent) : '';
  const bodyText = normalizeText(document.body.innerText || document.body.textContent || '');
  const role = candidate.role || extractCommunicationRole(bodyText) || '';
  return {
    task,
    url: window.location.href,
    includeScreenshot: Boolean(settings.pageIntelligenceUseScreenshot),
    currentCandidate: candidate,
    candidatePanelText: panelText,
    topLevelText: candidate.topLevelText || extractCandidateTopLevelText(scope, candidate.name) || '',
    roleContext: extractCommunicationRoleContext(bodyText, role),
    pageText: bodyText.slice(0, 16000),
    textBlocks: collectVisibleTextBlocks(),
  };
}

function shouldReplaceCandidateField(currentValue, aiValue, field = '') {
  const current = normalizeText(currentValue || '');
  const next = normalizeText(aiValue || '');
  if (!next) return false;
  if (!current) return true;
  if (field === 'topLevelText') return next.length > current.length && !isPollutedCandidateText(next);
  if (field === 'jobRequirement') return looksLikeJobRequirement(next) && next.length > current.length;
  return current.length < 3 || current === '候选人' || current === '待确认';
}

function mergePageIntelligenceCandidate(candidate, extracted = {}) {
  const merged = { ...candidate };
  const fieldMap = {
    name: 'name',
    role: 'role',
    education: 'education',
    experience: 'experience',
    expectedSalary: 'expectedSalary',
    ageGender: 'ageGender',
    currentCompany: 'currentCompany',
    summary: 'summary',
    topLevelText: 'topLevelText',
    jobRequirement: 'jobRequirement',
    resumeStatus: 'resumeStatus',
  };
  Object.entries(fieldMap).forEach(([sourceField, targetField]) => {
    const value = extracted[sourceField];
    if (shouldReplaceCandidateField(merged[targetField], value, targetField)) {
      merged[targetField] = value;
    }
  });
  if (extracted.topLevelText && !isPollutedCandidateText(extracted.topLevelText)) {
    merged.rawText = merged.resumeDetailText || extracted.topLevelText;
  }
  if (extracted.jobRequirement && looksLikeJobRequirement(extracted.jobRequirement)) {
    merged.jobRequirement = extracted.jobRequirement;
  }
  merged.pageIntelligence = {
    provider: extracted.provider || '',
    confidence: Number(extracted.confidence || 0),
    evidence: extracted.evidence || [],
    enhancedAt: new Date().toISOString(),
  };
  merged.qualityScore = calculateResumeQuality(merged);
  merged.evaluation = evaluateCandidate(merged);
  return merged;
}

async function enhanceCandidateWithPageIntelligence(candidate, scope = document, task = 'candidate-extract') {
  if (!candidate || settings.pageIntelligenceEnabled === false) return candidate;
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'extractPageIntelligence',
      payload: buildPageIntelligencePayload(candidate, scope, task),
    });
    if (!response?.success || response.skipped || !response.extracted) {
      return candidate;
    }
    const extracted = {
      ...response.extracted,
      provider: response.provider || response.model || '',
    };
    const enhanced = mergePageIntelligenceCandidate(candidate, extracted);
    notifyPopup('log', {
      message: `GLM页面识别增强：${enhanced.name || '候选人'}｜置信度 ${enhanced.pageIntelligence?.confidence || 0}%`,
      type: 'success',
    });
    return enhanced;
  } catch (err) {
    console.warn('[招聘助手] 页面智能识别失败，使用本地规则:', err.message);
    return candidate;
  }
}

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function calculateResumeQuality(info) {
  const fields = ['name', 'role', 'education', 'experience', 'expectedSalary', 'summary', 'phone', 'email'];
  const filled = fields.filter(field => Boolean(info[field])).length;
  return Math.round((filled / fields.length) * 100);
}

function evaluateCandidate(info) {
  const text = [
    info.name,
    info.role,
    info.education,
    info.experience,
    info.expectedSalary,
    info.currentCompany,
    info.summary,
    info.jobRequirement,
    info.resumeDetailText,
    info.rawText,
  ].filter(Boolean).join(' ');

  const hard = evaluateHardConditions(info, text);
  const skills = evaluateSkillMatch(info, text);
  const projects = evaluateProjectMatch(info, text);
  const salary = evaluateSalaryMatch(info, text);
  const jd = evaluateJobRequirementMatch(info);
  const baseScore = hard.score + skills.score + projects.score + salary.score;
  const score = Math.max(0, Math.min(100, baseScore + jd.scoreAdjustment));
  const risks = [
    ...hard.risks,
    ...skills.risks,
    ...projects.risks,
    ...salary.risks,
    ...jd.risks,
    ...detectGeneralRisks(text),
  ];
  const strengths = [
    ...hard.strengths,
    ...skills.strengths,
    ...projects.strengths,
    ...salary.strengths,
    ...jd.strengths,
  ];

  let recommendation = '不推荐';
  let level = 'no';
  let nextStep = '礼貌婉拒或放入人才库';
  if (score >= AGENTS_EVALUATION_RULES.strongRecommendThreshold) {
    recommendation = '强烈推荐';
    level = 'strong';
    nextStep = '立即安排面试';
  } else if (score >= AGENTS_EVALUATION_RULES.veryRecommendThreshold) {
    recommendation = '非常推荐';
    level = 'very';
    nextStep = '优先电话沟通并推进面试';
  } else if (score >= AGENTS_EVALUATION_RULES.recommendThreshold) {
    recommendation = '推荐';
    level = 'recommend';
    nextStep = '点击求简历，补充确认项目职责、技术深度和薪资期望';
  }

  return {
    score,
    recommendation,
    level,
    nextStep,
    suitable: score >= AGENTS_EVALUATION_RULES.recommendThreshold,
    dimensions: {
      hard,
      skills,
      projects,
      salary,
      jd,
    },
    strengths: strengths.slice(0, 5),
    risks: risks.slice(0, 5),
    rejectionReasons: buildRejectionReasons({ hard, skills, projects, salary, jd, risks }),
    generatedAt: new Date().toISOString(),
  };
}

function evaluateJobRequirementMatch(info) {
  const jd = normalizeText(info.jobRequirement || '');
  if (!jd) {
    return {
      scoreAdjustment: 0,
      match: 'partial',
      strengths: [],
      risks: ['未抓取到岗位JD，当前评估未能按岗位专属要求校准'],
      matched: [],
      missing: [],
    };
  }
  const resumeText = normalizeText([
    info.education,
    info.experience,
    info.currentCompany,
    info.summary,
    info.rawText,
  ].filter(Boolean).join(' '));
  const requiredKeywords = extractRequirementKeywords(jd);
  const matched = requiredKeywords.filter(keyword => resumeText.toLowerCase().includes(keyword.toLowerCase()));
  const missing = requiredKeywords.filter(keyword => !matched.includes(keyword));
  const ratio = requiredKeywords.length ? matched.length / requiredKeywords.length : 0;
  const scoreAdjustment = ratio >= 0.6 ? 6 : ratio >= 0.35 ? 0 : -8;
  return {
    scoreAdjustment,
    match: ratio >= 0.6 ? 'match' : ratio >= 0.35 ? 'partial' : 'weak',
    strengths: matched.length ? [`岗位JD关键词匹配：${matched.slice(0, 8).join('、')}`] : [],
    risks: missing.length ? [`岗位JD关键要求未体现：${missing.slice(0, 8).join('、')}`] : [],
    matched,
    missing,
  };
}

function extractRequirementKeywords(jd) {
  const keywords = [
    ...SKILL_KEYWORDS,
    '本科', '硕士', '博士', '统招', '计算机', '3年', '5年', '8年',
    '管理', '团队', '架构设计', '高并发', '分布式', '云原生', 'AI', '大模型',
    '数据分析', '项目管理', '沟通', '跨部门',
  ];
  return [...new Set(keywords.filter(keyword => jd.toLowerCase().includes(keyword.toLowerCase())))].slice(0, 16);
}

function buildRejectionReasons({ hard, skills, projects, salary, jd, risks }) {
  const reasons = [];
  if (hard.match === 'weak') reasons.push(`硬性条件不足：${hard.risks[0] || '学历、年限或专业信息未满足要求'}`);
  if (skills.match === 'weak') reasons.push(`技能匹配不足：${skills.risks[0] || '核心技能关键词不足'}`);
  if (projects.match === 'weak') reasons.push(`项目经验不足：${projects.risks[0] || '缺少相关项目职责或成果'}`);
  if (salary.match === 'weak') reasons.push(`薪资匹配风险：${salary.risks[0] || '薪资期望需确认'}`);
  if (jd.match === 'weak') reasons.push(`岗位JD匹配不足：${jd.risks[0] || '简历未体现岗位关键要求'}`);
  return (reasons.length ? reasons : risks.slice(0, 3).map(item => `风险项：${item}`)).slice(0, 5);
}

function evaluateHardConditions(info, text) {
  let score = 0;
  const strengths = [];
  const risks = [];

  if (/博士|硕士|本科|211|985/i.test(info.education || text)) {
    score += 8;
    strengths.push(`学历信息较完整：${info.education || '简历中含本科及以上/重点院校信号'}`);
  } else if (/大专|专科/i.test(info.education || text)) {
    score += 4;
    risks.push('学历可能低于部分岗位要求，需核对JD');
  } else {
    score += 3;
    risks.push('学历信息不足，需进一步确认');
  }

  if (info.experience || /\d+\s*年|应届|实习/i.test(text)) {
    score += 6;
    strengths.push(`工作年限可识别：${info.experience || '简历中含年限信息'}`);
  } else {
    score += 2;
    risks.push('工作年限信息不足');
  }

  const age = parseAge(text);
  if (!age) {
    score += 3;
  } else if (age <= 45) {
    score += 4;
    strengths.push(`年龄在常规招聘范围内：${age}岁`);
  } else {
    score += 1;
    risks.push(`年龄 ${age} 岁，需确认岗位适配性`);
  }

  const majorRelated = /计算机|软件|电子|通信|自动化|机械|信息|数学|统计/i.test(text);
  if (majorRelated) {
    score += 2;
    strengths.push('专业或背景与技术/工程方向相关');
  } else {
    risks.push('专业相关性未明确');
  }

  return {
    score: Math.min(score, AGENTS_EVALUATION_RULES.hard),
    max: AGENTS_EVALUATION_RULES.hard,
    match: score >= 14 ? 'match' : score >= 9 ? 'partial' : 'weak',
    strengths,
    risks,
  };
}

function evaluateSkillMatch(info, text) {
  const matched = SKILL_KEYWORDS.filter(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
  let score = Math.min(AGENTS_EVALUATION_RULES.skills, matched.length * 4);
  const role = info.role || '';
  const roleTokens = role.split(/[\/\s,，、|-]+/).filter(token => token.length >= 2);
  const roleMatched = roleTokens.filter(token => text.includes(token));
  if (roleMatched.length) score += 4;

  const strengths = matched.length
    ? [`技能关键词匹配：${matched.slice(0, 8).join('、')}`]
    : [];
  const risks = matched.length < 3
    ? ['技能关键词不足，需结合完整简历或面试追问确认']
    : [];

  return {
    score: Math.min(score, AGENTS_EVALUATION_RULES.skills),
    max: AGENTS_EVALUATION_RULES.skills,
    match: score >= 22 ? 'match' : score >= 12 ? 'partial' : 'weak',
    matchedKeywords: matched,
    strengths,
    risks,
  };
}

function evaluateProjectMatch(info, text) {
  const matched = PROJECT_KEYWORDS.filter(keyword => text.includes(keyword));
  const hasMetric = /\d+%|\d+\s*倍|\d+\s*人|\d+\s*万|QPS|DAU|ROI|成本|效率|性能/i.test(text);
  let score = Math.min(AGENTS_EVALUATION_RULES.projects, matched.length * 3);
  if (info.summary) score += 6;
  if (hasMetric) score += 6;
  if (/主导|负责人|Owner|核心/i.test(text)) score += 5;

  const strengths = [];
  const risks = [];
  if (matched.length) strengths.push(`项目经历信号：${matched.slice(0, 6).join('、')}`);
  if (hasMetric) strengths.push('简历中出现量化成果信号');
  if (!matched.length && !info.summary) risks.push('项目经历信息不足，需追问具体职责和成果');

  return {
    score: Math.min(score, AGENTS_EVALUATION_RULES.projects),
    max: AGENTS_EVALUATION_RULES.projects,
    match: score >= 22 ? 'match' : score >= 12 ? 'partial' : 'weak',
    strengths,
    risks,
  };
}

function evaluateSalaryMatch(info, text) {
  const salary = info.expectedSalary || extractByRegex(text, /\d+\s*[-~到]\s*\d+\s*[kK万]?|\d+\s*[kK]\s*[-~到]\s*\d+\s*[kK]/);
  if (!salary) {
    return {
      score: 8,
      max: AGENTS_EVALUATION_RULES.salary,
      match: 'partial',
      strengths: [],
      risks: ['薪资期望未明确，需沟通预算匹配'],
    };
  }

  const abnormal = /100k|100K|百万|面议/i.test(salary) && !/面议/i.test(salary);
  return {
    score: abnormal ? 8 : AGENTS_EVALUATION_RULES.salary,
    max: AGENTS_EVALUATION_RULES.salary,
    match: abnormal ? 'weak' : 'match',
    strengths: abnormal ? [] : [`薪资期望可识别：${salary}`],
    risks: abnormal ? [`薪资期望可能异常：${salary}`] : [],
  };
}

function detectGeneralRisks(text) {
  const risks = [];
  if (/频繁跳槽|多段经历|gap|空窗|离职原因/i.test(text)) risks.push('存在稳定性或空档期信号，需进一步确认');
  if (/了解|入门|自学/i.test(text) && !/熟悉|精通|负责|主导/i.test(text)) risks.push('技能深度可能不足');
  if (/外包|短期|试用/i.test(text)) risks.push('需确认项目归属、职责深度和稳定性');
  return risks;
}

function parseAge(text) {
  const match = text.match(/(\d{2})\s*岁/);
  if (!match) return null;
  const age = Number(match[1]);
  return age > 15 && age < 70 ? age : null;
}

function detectRecruiterAccountInfo() {
  const benefitRightInfo = detectAccountInfoRightOfBenefits();
  if (benefitRightInfo.name) {
    persistDetectedAccount(benefitRightInfo);
    return benefitRightInfo;
  }

  return { name: '', platform: 'BOSS直聘', detectedAt: new Date().toISOString() };
}

function detectAccountInfoRightOfBenefits() {
  const anchors = findElementsContainingText('账号权益')
    .filter(isActionableElement)
    .sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectA.top - rectB.top || rectB.right - rectA.right;
    });

  for (const anchor of anchors) {
    const anchorRect = anchor.getBoundingClientRect();
    const scope = anchor.closest('header, nav, [class*="header"], [class*="top"], [class*="nav"], [class*="bar"]') || document.body;
    const avatar = findTopRightAvatarAfter(anchor, scope);
    const avatarRect = avatar?.getBoundingClientRect();
    if (!avatarRect) continue;
    const rightBoundary = avatarRect.left + 8;
    const candidates = Array.from(scope.querySelectorAll('span, div, a, button, p, label'))
      .map(element => {
        if (element === anchor || !isActionableElement(element)) return null;
        const rect = element.getBoundingClientRect();
        const text = sanitizeAccountText(getElementOwnText(element) || element.textContent || '');
        if (!text || !isLikelyRecruiterName(text, element)) return null;

        const isRightSide = rect.left >= anchorRect.right - 8;
        const isLeftOfAvatar = rect.right <= rightBoundary;
        const isSameLine = rect.top < anchorRect.bottom + 36 && rect.bottom > anchorRect.top - 36;
        const isHeaderArea = rect.top <= Math.max(anchorRect.bottom + 80, 160);
        if (!isRightSide || !isLeftOfAvatar || !isSameLine || !isHeaderArea) return null;

        const distanceToAvatar = avatarRect ? Math.abs(avatarRect.left - rect.right) : 80;
        const distance = Math.max(0, rect.left - anchorRect.right) + Math.abs(rect.top - anchorRect.top) * 0.8 + distanceToAvatar * 0.4;
        const hasAvatarNeighbor = Boolean(
          element.querySelector('img, [class*="avatar"]') ||
          element.previousElementSibling?.querySelector?.('img, [class*="avatar"]') ||
          element.parentElement?.querySelector?.('img, [class*="avatar"]')
        );
        const score = distance - (hasAvatarNeighbor ? 30 : 0) - (/HR|招聘|经理|主管|顾问|女士|先生/.test(text) ? 20 : 0);
        return { element, text, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    if (candidates.length) {
      return buildAccountInfo(candidates[0].text, 'account-benefits-right', candidates[0].element);
    }
  }

  return { name: '', platform: 'BOSS直聘', detectedAt: new Date().toISOString() };
}

function findTopRightAvatarAfter(anchor, scope) {
  const anchorRect = anchor.getBoundingClientRect();
  const avatarSelectors = [
    'img',
    '[class*="avatar"]',
    '[class*="head"]',
    '[class*="photo"]',
    '[class*="portrait"]',
  ];
  const avatars = Array.from(scope.querySelectorAll(avatarSelectors.join(',')))
    .map(element => {
      if (!isActionableElement(element)) return null;
      const rect = element.getBoundingClientRect();
      const isRightOfBenefits = rect.left >= anchorRect.right - 8;
      const isSameLine = rect.top < anchorRect.bottom + 44 && rect.bottom > anchorRect.top - 44;
      const isReasonableAvatar = rect.width >= 18 && rect.width <= 72 && rect.height >= 18 && rect.height <= 72;
      const isTopRight = rect.top <= Math.max(anchorRect.bottom + 90, 170);
      if (!isRightOfBenefits || !isSameLine || !isReasonableAvatar || !isTopRight) return null;
      return { element, rect };
    })
    .filter(Boolean)
    .sort((a, b) => b.rect.right - a.rect.right);

  return avatars[0]?.element || null;
}

function getElementOwnText(element) {
  return normalizeText(Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent || '')
    .join(' '));
}

function findElementsContainingText(keyword) {
  const elements = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const text = normalizeText(node.textContent || '');
      if (!text.includes(keyword)) return NodeFilter.FILTER_SKIP;
      if (text.length > 80 && !/^账号权益$/.test(text)) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode();
  while (current && elements.length < 20) {
    const directText = normalizeText(Array.from(current.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent || '')
      .join(' '));
    if (directText.includes(keyword) || normalizeText(current.textContent || '') === keyword) {
      elements.push(current);
    }
    current = walker.nextNode();
  }
  return elements;
}

function sanitizeAccountText(text) {
  return normalizeText(text)
    .replace(/账号权益/g, ' ')
    .replace(/权益|续费|充值|购买|升级|会员|企业版|帮助|设置/g, ' ')
    .replace(/在线|离线|未读|消息|\d+条/g, ' ')
    .replace(/[｜|]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(part => part && part.length <= 24)
    .slice(0, 3)
    .join(' ')
    .trim();
}

function buildAccountInfo(name, source, element) {
  return {
    name: sanitizeAccountText(name).slice(0, 40),
    platform: 'BOSS直聘',
    source,
    detectedAt: new Date().toISOString(),
    selectorHint: element ? getElementSelectorHint(element) : '',
  };
}

function persistDetectedAccount(info) {
  chrome.storage.local.set({ detectedAccount: info }, () => {
    chrome.storage.local.get(['settings'], (result) => {
      const currentSettings = result.settings || {};
      if (currentSettings.accountNameManual) {
        chrome.runtime.sendMessage({
          action: 'detectedAccountUpdated',
          accountInfo: info,
        }).catch(() => {});
        return;
      }
      const nextSettings = {
        ...currentSettings,
        accountName: info.name,
        accountPlatform: info.platform || 'BOSS直聘',
      };
      chrome.storage.local.set({ settings: nextSettings });
      chrome.runtime.sendMessage({
        action: 'detectedAccountUpdated',
        accountInfo: info,
      }).catch(() => {});
    });
  });
}

function getElementSelectorHint(element) {
  const parts = [];
  if (element.id) parts.push(`#${element.id}`);
  if (element.className && typeof element.className === 'string') {
    parts.push(`.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`);
  }
  return `${element.tagName.toLowerCase()}${parts.join('')}`.slice(0, 120);
}

function isLikelyRecruiterName(text, element = null) {
  if (!text || text.length < 2 || text.length > 40) return false;
  if (/登录|注册|消息|职位|简历|沟通|推荐|搜索|设置|帮助|首页|账号权益|全部|筛选|排序|投递|候选人|人才|牛人|公司|岗位|下载|导出|刷新|通知|数据/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (element) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 260 || rect.height > 80) return false;
  }
  return /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_.·\-\s]{1,39}$/.test(text);
}

function isSameResume(a, b) {
  if (a.id && b.id && a.id === b.id) return true;
  if (a.phone && b.phone && a.phone === b.phone) return true;
  if (a.email && b.email && a.email === b.email) return true;
  return Boolean(a.name && b.name && a.role && b.role && a.name === b.name && a.role === b.role);
}

async function runResumeActions({
  scope = document,
  contextName = '候选人',
  manual = false,
  sequenceOffset = 0,
} = {}) {
  const targets = findActionTargets(scope).filter(target => {
    if (processedActionKeys.has(target.key)) return false;
    if (target.type === 'accept') return manual || settings.autoAccept;
    if (target.type === 'request') return manual || settings.autoRequestResume;
    return false;
  });

  const summary = {
    success: true,
    total: targets.length,
    executed: 0,
    skipped: 0,
    blockedBySafety: false,
    actions: [],
  };

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (!canPerformOperation()) {
      summary.blockedBySafety = true;
      break;
    }

    const delay = humanDelay() + ((sequenceOffset + index) * (3000 + Math.random() * 5000));
    await sleep(delay);
    await simulateHumanScroll();
    await simulateActionDwell();
    await simulateMouseMove(target.button);
    await sleep(800 + Math.random() * 1200);

    const success = simulateHumanClick(target.button);
    processedActionKeys.add(target.key);

    if (success) {
      recordOperation();
      summary.executed++;
      summary.actions.push({ type: target.type, label: target.label, text: target.text, success: true });
      notifyPopup('resumeActionExecuted', {
        name: contextName,
        actionType: target.type,
        actionLabel: target.label,
      });
      console.log(`[招聘助手] ✅ 已执行${target.label}: ${contextName}`);
      await simulateActionDwell();
    } else {
      summary.skipped++;
      summary.actions.push({ type: target.type, label: target.label, text: target.text, success: false });
      reportError(`${target.label}点击失败`);
    }
  }

  return summary;
}

async function browseCandidatesAndRunActions({
  manual = false,
  maxCandidates = 10,
} = {}) {
  if (isBrowsingCandidates) {
    return { success: false, message: '候选人浏览流程正在执行中' };
  }

  isBrowsingCandidates = true;
  const safeMaxCandidates = Math.min(
    Number(maxCandidates || settings.maxCandidatesPerRun || 5),
    Number(settings.maxCandidatesPerRun || 5)
  );
  const targets = findCandidateNavigationTargets().slice(0, safeMaxCandidates);
  const summary = {
    success: true,
    total: targets.length,
    browsed: 0,
    actionExecuted: 0,
    blockedBySafety: false,
    details: [],
  };

  try {
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      if (!manual && !settings.autoBrowseProfiles) break;
      if (!canPerformOperation()) {
        summary.blockedBySafety = true;
        break;
      }

      const previousUrl = window.location.href;
      const previousText = normalizeText(document.body.textContent || '').slice(0, 500);
      const delay = humanDelay() + (index * (5000 + Math.random() * 9000));

      await sleep(delay);
      await simulateHumanScroll();
      await simulateMouseMove(target.clickable);
      await sleep(1200 + Math.random() * 1800);

      const clicked = simulateHumanClick(target.clickable);
      processedBrowseKeys.add(target.key);
      if (!clicked) {
        summary.details.push({ name: target.name, browsed: false, actions: 0 });
        reportError(`浏览候选人失败: ${target.name}`);
        continue;
      }

      recordOperation();
      summary.browsed++;
      notifyPopup('candidateBrowsed', { name: target.name });
      await waitForCommunicationInterface(previousUrl, previousText);
      await simulateCandidateDwell();

      if (settings.autoScrape) {
        await openCurrentCandidateDetailFromSummary();
        await scanCurrentPage({ notify: false });
      }

      const actionResult = await runResumeActions({
        scope: document,
        contextName: target.name,
        manual: true,
        sequenceOffset: index,
      });
      summary.actionExecuted += actionResult.executed;
      summary.details.push({
        name: target.name,
        browsed: true,
        actions: actionResult.executed,
      });

      if (actionResult.blockedBySafety) {
        summary.blockedBySafety = true;
        break;
      }
      await maybeTakeLongBreak(summary.browsed);
    }
  } finally {
    isBrowsingCandidates = false;
  }

  return summary;
}

async function startRecruitmentWorkflow({ maxCandidates = 20 } = {}) {
  if (isBrowsingCandidates) {
    return { success: false, message: '任务流程正在执行中' };
  }

  notifyPopup('log', {
    message: '一键任务已启动，开始检查候选人对话',
    type: 'info',
  });
  isBrowsingCandidates = true;
  const summary = {
    success: true,
    processed: 0,
    requested: 0,
    accepted: 0,
    skipped: 0,
    savedJobs: 0,
    blockedBySafety: false,
    details: [],
  };

  try {
    for (let index = 0; index < maxCandidates; index++) {
      if (!canPerformOperation()) {
        summary.blockedBySafety = true;
        break;
      }

      const target = findNextWorkflowCandidateTarget();
      if (target) {
        await openWorkflowCandidate(target, index);
      } else if (index > 0) {
        break;
      }

      const accepted = await acceptAttachmentResumeIfPresent(`候选人${index + 1}`);
      if (accepted.executed > 0) summary.accepted += accepted.executed;

      await openCurrentCandidateDetailFromSummary();
      const candidate = await scrapeChatCandidateInfo();
      if (!candidate) {
        summary.skipped++;
        summary.details.push({ name: target?.name || '候选人', reason: '未识别候选人信息' });
        workflowProcessedKeys.add(target?.key || `current_${index}`);
        continue;
      }

      const beforeRequirement = Boolean(candidate.jobRequirement);
      await ensureChatJobRequirement(candidate);
      if (!beforeRequirement && candidate.jobRequirement) summary.savedJobs++;

      const acceptedResume = accepted.executed > 0;
      const openedOnlineResume = await openOnlineResumeIfPresent();
      const refreshed = openedOnlineResume
        ? await scrapeVisibleOnlineResumeInfo(candidate)
        : await scrapeChatCandidateInfo();
      const finalCandidate = refreshed || candidate;
      if (acceptedResume) {
        finalCandidate.hasResume = true;
        finalCandidate.hasAttachmentResume = true;
        finalCandidate.resumeAttachmentType = 'attachment';
        finalCandidate.resumeStatus = '有附件简历（已同意接收）';
        finalCandidate.resumeEvidence = 'attachmentAccepted';
        finalCandidate.id = `resume_${hashString(`${finalCandidate.name || ''}|${finalCandidate.role || ''}|attachment|${finalCandidate.receivedDate || ''}`)}`;
      } else if (openedOnlineResume) {
        finalCandidate.hasResume = true;
        finalCandidate.hasAttachmentResume = false;
        finalCandidate.resumeAttachmentType = 'none';
        finalCandidate.resumeStatus = '无附件简历（在线简历）';
        finalCandidate.resumeEvidence = 'onlineResumeOpened';
        finalCandidate.id = `resume_${hashString(`${finalCandidate.name || ''}|${finalCandidate.role || ''}|online|${finalCandidate.receivedDate || ''}`)}`;
      }
      if (!finalCandidate.evaluation) finalCandidate.evaluation = evaluateCandidate(finalCandidate);

      const score = Number(finalCandidate.evaluation?.score || 0);
      const needsResumeRequest = score >= AGENTS_EVALUATION_RULES.recommendThreshold && !finalCandidate.hasAttachmentResume;
      finalCandidate.resumeRequestRequired = needsResumeRequest;
      if (needsResumeRequest) {
        if (openedOnlineResume) {
          await closeResumeOverlayIfPresent();
          await prepareCommunicationActionsForRequest();
        }
        const requestContextKey = getCurrentWorkflowKey(finalCandidate);
        const requestResult = await clickResumeActionType(
          'request',
          finalCandidate.name || target?.name || '候选人',
          { contextKey: requestContextKey }
        );
        finalCandidate.resumeRequestExecuted = requestResult.executed > 0;
        finalCandidate.resumeRequestStatus = requestResult.executed > 0
          ? (requestResult.viaMessage ? '已发送求简历消息' : (requestResult.alreadyRequested ? (requestResult.reason || '已索要简历') : '已点击求简历'))
          : '求简历失败';
        finalCandidate.resumeRequestAt = requestResult.executed > 0 ? new Date().toISOString() : '';
        finalCandidate.resumeRequestButtonText = requestResult.targetText || '';
        finalCandidate.resumeRequestMethod = requestResult.viaMessage ? 'message' : 'button';
        finalCandidate.resumeRequestMessage = requestResult.messageText || '';
        finalCandidate.resumeRequestFallbackReason = requestResult.viaMessage ? requestResult.reason || '' : '';
        finalCandidate.resumeRequestError = requestResult.executed > 0 ? '' : (requestResult.reason || '未找到或未能点击求简历按钮');
        finalCandidate.resumeRequestAvailableActions = requestResult.availableActions || [];
        summary.requested += requestResult.executed;
        if (!requestResult.executed) summary.skipped++;
      } else {
        finalCandidate.resumeRequestExecuted = false;
        finalCandidate.resumeRequestStatus = finalCandidate.hasAttachmentResume ? '无需索要（已有附件简历）' : '未达到求简历阈值';
        finalCandidate.resumeRequestError = '';
        summary.skipped++;
      }
      await saveResumeData(finalCandidate);

      summary.processed++;
      summary.details.push({
        name: finalCandidate.name || target?.name || '候选人',
        role: finalCandidate.role || '',
        score,
        requested: needsResumeRequest,
        requestStatus: finalCandidate.resumeRequestStatus,
        requestError: finalCandidate.resumeRequestError,
        resumeType: finalCandidate.hasAttachmentResume ? '有附件简历' : '无附件简历',
      });
      workflowProcessedKeys.add(target?.key || getCurrentWorkflowKey(finalCandidate));
      await maybeTakeLongBreak(summary.processed);
    }
  } finally {
    isBrowsingCandidates = false;
  }

  notifyPopup('log', {
    message: `一键任务完成：处理 ${summary.processed} 位，求简历 ${summary.requested} 次，同意附件 ${summary.accepted} 次`,
    type: 'success',
  });
  return summary;
}

function findNextWorkflowCandidateTarget() {
  const targets = findCandidateNavigationTargets();
  const unread = targets.filter(target => {
    const text = normalizeText(target.card?.textContent || '');
    return /未读|\d+\s*$|新招呼|红点/.test(text) || target.card?.querySelector?.('[class*="red"], [class*="badge"], [class*="unread"]');
  });
  return [...unread, ...targets].find(target => !workflowProcessedKeys.has(target.key)) || null;
}

async function openWorkflowCandidate(target, index = 0) {
  activeWorkflowCandidateHint = {
    name: cleanCandidateName(target?.name || ''),
    key: target?.key || '',
    openedAt: Date.now(),
  };
  const previousUrl = window.location.href;
  const previousText = normalizeText(document.body.textContent || '').slice(0, 500);
  const delay = humanDelay() + (index * (2500 + Math.random() * 4000));
  await sleep(delay);
  await simulateHumanScroll();
  await simulateMouseMove(target.clickable);
  await sleep(800 + Math.random() * 1200);
  const clicked = simulateHumanClick(target.clickable);
  if (clicked) {
    recordOperation();
    notifyPopup('candidateBrowsed', { name: target.name });
    await waitForCommunicationInterface(previousUrl, previousText);
    await simulateCandidateDwell();
  }
  return clicked;
}

async function acceptAttachmentResumeIfPresent(contextName = '候选人') {
  const bodyText = normalizeText(document.body.textContent || '');
  if (!/(附件简历|发送附件简历|是否同意|想发送附件简历)/.test(bodyText)) {
    return { executed: 0 };
  }
  return clickResumeActionType('accept', contextName);
}

async function clickResumeActionType(type, contextName = '候选人', options = {}) {
  const contextKey = normalizeText(options.contextKey || '');
  const effectiveActionKey = (item) => contextKey ? `${item.key}_${hashString(contextKey)}` : item.key;
  let target = findActionTargets(document).find(item => item.type === type && !processedActionKeys.has(effectiveActionKey(item)));
  const summary = { executed: 0, skipped: 0, reason: '', targetText: '' };
  const existingStatus = type === 'request' ? findExistingResumeRequestStatus() : '';
  if (!target && existingStatus) {
    return {
      ...summary,
      executed: 1,
      alreadyRequested: true,
      reason: existingStatus,
      viaMessage: existingStatus === '已发送求简历消息',
      messageText: existingStatus === '已发送求简历消息' ? RESUME_REQUEST_FALLBACK_MESSAGE : '',
      targetText: existingStatus === '已发送求简历消息' ? `兜底消息：${RESUME_REQUEST_FALLBACK_MESSAGE}` : '',
    };
  }
  if (!target && type === 'request') {
    await closeResumeOverlayIfPresent();
    await prepareCommunicationActionsForRequest();
    target = findActionTargets(document).find(item => item.type === type && !processedActionKeys.has(effectiveActionKey(item)));
  }
  if (!target) {
    const availableActions = findActionTargets(document).map(item => `${item.type}:${item.text}`).slice(0, 8);
    if (type === 'request') {
      const fallback = await sendResumeRequestFallbackMessage(contextName, '未找到求简历按钮', contextKey);
      if (fallback.executed > 0) {
        return {
          ...fallback,
          availableActions,
        };
      }
      return {
        ...summary,
        skipped: 1,
        reason: `未找到求简历按钮，且兜底消息未发送：${fallback.reason || '未知原因'}`,
        availableActions,
      };
    }
    return {
      ...summary,
      skipped: 1,
      reason: '未找到动作按钮',
      availableActions,
    };
  }
  if (!canPerformOperation()) return { ...summary, blockedBySafety: true, reason: '安全策略限制操作' };

  await sleep(humanDelay());
  await simulateHumanScroll();
  await simulateActionDwell();
  await simulateMouseMove(target.button);
  await sleep(700 + Math.random() * 1000);
  const success = simulateHumanClick(target.button);
  summary.targetText = target.text;
  if (success) {
    processedActionKeys.add(effectiveActionKey(target));
    recordOperation();
    summary.executed = 1;
    notifyPopup('resumeActionExecuted', {
      name: contextName,
      actionType: target.type,
      actionLabel: target.label,
    });
    await simulateActionDwell();
  } else {
    if (type === 'request') {
      const fallback = await sendResumeRequestFallbackMessage(contextName, `求简历按钮“${target.text}”点击未生效`, contextKey);
      if (fallback.executed > 0) return fallback;
    }
    summary.skipped = 1;
    summary.reason = '点击动作未生效';
  }
  return summary;
}

async function openOnlineResumeIfPresent() {
  const target = findClickableByText(['在线简历', '查看在线简历', '简历详情']);
  if (!target || !canPerformOperation()) return false;
  await simulateMouseMove(target);
  await sleep(700 + Math.random() * 1000);
  const before = normalizeText(document.body.textContent || '').slice(0, 800);
  const clicked = simulateHumanClick(target);
  if (!clicked) return false;
  recordOperation();
  await sleep(1800 + Math.random() * 2600);
  return normalizeText(document.body.textContent || '').slice(0, 800) !== before;
}

async function scrapeVisibleOnlineResumeInfo(baseCandidate = {}) {
  const resumeContainer = findOnlineResumeContainer();
  const detailText = await collectOnlineResumeDetailText(resumeContainer);
  const topLevelText = extractCandidateTopLevelText(resumeContainer || document, baseCandidate.name) ||
                       cleanCandidateTopLevelText(findCandidateSummaryPanel()?.textContent || '') ||
                       cleanCandidateTopLevelText(detailText);
  if (!topLevelText) return null;
  let resumeInfo = {
    ...baseCandidate,
    source: baseCandidate.source || 'BOSS直聘',
    sourceUrl: window.location.href,
    receivedDate: baseCandidate.receivedDate || new Date().toISOString().split('T')[0],
    receivedTime: baseCandidate.receivedTime || new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
    accountName: baseCandidate.accountName || settings.accountName || detectRecruiterAccountInfo().name || '',
    accountPlatform: baseCandidate.accountPlatform || settings.accountPlatform || 'BOSS直聘',
    hasResume: true,
    hasAttachmentResume: false,
    resumeAttachmentType: 'none',
    resumeStatus: '无附件简历（在线简历）',
    resumeEvidence: 'onlineResumeOpened',
    topLevelText,
    resumeDetailText: detailText,
    rawText: detailText || topLevelText,
    education: extractEducationFromText(topLevelText) || baseCandidate.education || '',
    experience: extractExperienceFromText(topLevelText) || baseCandidate.experience || '',
    expectedSalary: extractExpectedSalaryFromText(topLevelText) || baseCandidate.expectedSalary || '',
    ageGender: extractAgeFromText(topLevelText) || baseCandidate.ageGender || '',
    summary: topLevelText,
  };
  if (!resumeInfo.role) {
    resumeInfo.role = extractCommunicationRole(topLevelText) || extractExpectedRole(topLevelText) || '';
  }
  if (!resumeInfo.name) {
    resumeInfo.name = extractChatCandidateName(topLevelText, topLevelText) || extractCandidateNameFromText(topLevelText);
  }
  resumeInfo = await enhanceCandidateWithPageIntelligence(resumeInfo, document, 'online-resume');
  await ensureChatJobRequirement(resumeInfo);
  resumeInfo.qualityScore = calculateResumeQuality(resumeInfo);
  resumeInfo.evaluation = evaluateCandidate(resumeInfo);
  return resumeInfo.name && resumeInfo.role ? resumeInfo : null;
}

function findOnlineResumeContainer() {
  const candidates = Array.from(document.querySelectorAll([
    '[role="dialog"]',
    '[class*="dialog"]',
    '[class*="modal"]',
    '[class*="drawer"]',
    '[class*="resume"]',
    '[class*="geek"]',
    'section',
    'article',
    'div',
  ].join(',')))
    .filter(isActionableElement)
    .map(element => {
      const text = getElementText(element);
      const rect = element.getBoundingClientRect();
      let score = 0;
      if (/工作经历/.test(text)) score += 5;
      if (/项目经验|项目经历/.test(text)) score += 4;
      if (/教育经历|期望职位/.test(text)) score += 3;
      if (/查看全部|继续沟通/.test(text)) score += 2;
      if (WORKBENCH_TEXT.candidateSummarySignal.test(text)) score += 2;
      if (/职位详情|薪资详情|工作地址/.test(text)) score -= 5;
      if (rect.width > 420 && rect.height > window.innerHeight * 0.45) score += 2;
      return { element, text, rect, score };
    })
    .filter(item => item.score >= 7 && item.text.length >= 120 && item.text.length <= 50000)
    .sort((a, b) => b.score - a.score || b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  return candidates[0]?.element || null;
}

async function collectOnlineResumeDetailText(container) {
  if (!container) return '';
  await clickExpandableText(container, ['查看全部', '展开全部', '查看更多']);
  const scrollTarget = findScrollableChild(container) || container;
  const snapshots = new Set();
  let previousTop = -1;
  for (let i = 0; i < 8; i++) {
    snapshots.add(getElementText(container));
    if (!scrollTarget || scrollTarget.scrollHeight <= scrollTarget.clientHeight + 40) break;
    previousTop = scrollTarget.scrollTop;
    scrollTarget.scrollBy({
      top: Math.max(180, scrollTarget.clientHeight * 0.72),
      behavior: 'smooth',
    });
    await sleep(450 + Math.random() * 650);
    await clickExpandableText(container, ['查看全部', '展开全部', '查看更多']);
    if (scrollTarget.scrollTop === previousTop) break;
  }
  if (scrollTarget && scrollTarget.scrollTo) {
    scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
  }
  return cleanOnlineResumeDetailText(Array.from(snapshots).join(' '));
}

function findScrollableChild(container) {
  const candidates = [container, ...Array.from(container.querySelectorAll('*'))]
    .filter(element => {
      try {
        const rect = element.getBoundingClientRect();
        return rect.height > 220 && rect.width > 320 && element.scrollHeight > element.clientHeight + 80;
      } catch (e) {
        return false;
      }
    })
    .sort((a, b) => (b.getBoundingClientRect().height * b.getBoundingClientRect().width) - (a.getBoundingClientRect().height * a.getBoundingClientRect().width));
  return candidates[0] || null;
}

function cleanOnlineResumeDetailText(text) {
  let normalized = normalizeText(text || '');
  const noiseMarkers = ['收藏', '转发', '举报', '继续沟通', '不合适', '求简历', '换电话', '换微信', '约面试'];
  noiseMarkers.forEach(marker => {
    normalized = normalized.replace(new RegExp(marker, 'g'), ' ');
  });
  normalized = normalizeText(normalized);
  const pageMarkers = ['全部职位', '新招呼', '沟通中', '账号权益', '招聘规范', '职位管理']
    .filter(marker => normalized.includes(marker)).length;
  const repeatedRoles = new Set(normalized.match(/[\u4e00-\u9fa5A-Za-z/+-]+(?:工程师|分析|开发|产品|运营)[^\s，。|]{0,18}\(J\d+\)/g) || []).size;
  return pageMarkers >= 3 || repeatedRoles >= 5
    ? cleanCandidateTopLevelText(normalized)
    : normalized.slice(0, 20000);
}

function findClickableByText(keywords) {
  const panel = findWorkbenchConversationPanel();
  const elements = findElementsInWorkbenchScope(panel, 'button, a, [role="button"], span, div');
  return elements
    .filter(element => {
    if (!isActionableElement(element)) return false;
    const text = getClickableText(element);
    if (!text || text.length > 40) return false;
    return keywords.some(keyword => text.includes(keyword));
  })
    .sort((a, b) => {
      const aText = getClickableText(a);
      const bText = getClickableText(b);
      const aExact = keywords.some(keyword => aText === keyword) ? 0 : 1;
      const bExact = keywords.some(keyword => bText === keyword) ? 0 : 1;
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aExact - bExact || aText.length - bText.length || aRect.top - bRect.top;
    })[0] || null;
}

function getCurrentWorkflowKey(candidate) {
  return `workflow_${hashString(`${window.location.pathname}|${candidate?.name || ''}|${candidate?.role || ''}`)}`;
}

async function scanCurrentPage({ notify = false } = {}) {
  const resumeCards = findResumeCards();
  const results = [];
  let savedCount = 0;
  let duplicateCount = 0;

  if (window.location.href.includes('/chat/') || normalizeText(document.body.textContent || '').includes('沟通职位')) {
    const chatInfo = await scrapeChatCandidateInfo();
    if (chatInfo) {
      results.push(chatInfo);
      const saveResult = await saveResumeData(chatInfo);
      if (saveResult.saved) savedCount++;
      if (saveResult.duplicate) duplicateCount++;
      if (notify && saveResult.saved) {
        notifyPopup('resumeScraped', chatInfo);
      }
    }
  }

  for (const card of resumeCards) {
    const resumeId = extractResumeId(card);
    if (!resumeId) continue;

    let resumeInfo = scrapeResumeInfo(card, resumeId);
    if (!resumeInfo) continue;
    resumeInfo = await enhanceCandidateWithPageIntelligence(resumeInfo, card, 'resume-card');

    results.push(resumeInfo);
    if (settings.autoScrape) {
      const saveResult = await saveResumeData(resumeInfo);
      if (saveResult.saved) savedCount++;
      if (saveResult.duplicate) duplicateCount++;
      if (notify && saveResult.saved) {
        notifyPopup('resumeScraped', resumeInfo);
      }
    }
  }

  return {
    success: true,
    resumes: results,
    savedCount,
    duplicateCount,
    browseTargets: findCandidateNavigationTargets().map(item => ({
      name: item.name,
      key: item.key,
    })),
    actionTargets: findActionTargets(document).map(item => ({
      type: item.type,
      label: item.label,
      text: item.text,
    })),
    message: `扫描完成，发现 ${results.length} 份简历，新增 ${savedCount} 份`,
  };
}

// ============================================================
// 聊天页面处理
// ============================================================

async function handleChatPage() {
  if (settings.autoScrape) {
    await scanCurrentPage({ notify: false });
  }

  const resumeLinks = document.querySelectorAll(
    'a[href*="resume"], [class*="resume"] a, [class*="attachment"]'
  );

  resumeLinks.forEach(link => {
    if (processedResumeIds.has(link.href)) return;

    const name = extractText(link.closest('[class*="message"]') || link.parentElement, [
      '[class*="name"]', '[class*="sender"]',
    ]);

    if (name) {
      console.log(`[招聘助手] 聊天中发现简历: ${name}`);
      processedResumeIds.add(link.href);
    }
  });
}

async function openCurrentCandidateDetailFromSummary() {
  const summary = findCandidateSummaryPanel();
  if (!summary || !canPerformOperation()) return false;
  await simulateMouseMove(summary);
  await sleep(700 + Math.random() * 1200);
  const before = normalizeText(document.body.textContent || '').slice(0, 800);
  const clicked = simulateHumanClick(summary);
  if (!clicked) return false;
  await sleep(1800 + Math.random() * 2600);
  return normalizeText(document.body.textContent || '').slice(0, 800) !== before;
}

async function scrapeChatCandidateInfo() {
  const panel = findCandidateSummaryPanel();
  if (!panel) return null;
  const text = extractCandidateTopLevelText(panel) || cleanCandidateTopLevelText(panel.textContent || '');
  const bodyText = normalizeText(document.body.textContent || '');
  const role = extractCommunicationRole(bodyText);
  const hintedName = Date.now() - Number(activeWorkflowCandidateHint?.openedAt || 0) < 120000
    ? cleanCandidateName(activeWorkflowCandidateHint?.name || '')
    : '';
  const name = extractChatCandidateName(text, bodyText) || hintedName;
  if (!name && !role && !text) return null;

  let resumeInfo = {
    id: `chat_${hashString(`${window.location.pathname}|${name}|${role}|${bodyText.slice(0, 500)}`)}`,
    name: name || '',
    role: role || extractExpectedRole(bodyText),
    source: 'BOSS直聘',
    sourceUrl: window.location.href,
    receivedDate: new Date().toISOString().split('T')[0],
    receivedTime: new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
    accountName: settings.accountName || detectRecruiterAccountInfo().name || '',
    accountPlatform: settings.accountPlatform || 'BOSS直聘',
    hasResume: false,
    hasAttachmentResume: false,
    resumeAttachmentType: 'none',
    resumeStatus: '仅沟通信息',
    topLevelText: text,
    rawText: text,
    education: extractEducationFromText(text),
    experience: extractExperienceFromText(text),
    expectedSalary: extractExpectedSalaryFromText(text) || extractExpectedSalaryFromText(extractCommunicationRoleContext(bodyText, role)),
    ageGender: extractAgeFromText(text),
    summary: text,
  };

  resumeInfo = await enhanceCandidateWithPageIntelligence(resumeInfo, panel, 'chat-candidate');
  await ensureChatJobRequirement(resumeInfo);
  resumeInfo.qualityScore = calculateResumeQuality(resumeInfo);
  resumeInfo.evaluation = evaluateCandidate(resumeInfo);
  return resumeInfo;
}

function findCandidateSummaryPanel() {
  const panel = findWorkbenchConversationPanel();
  const elements = Array.from((panel || document).querySelectorAll('section, header, article, [class*="card"], [class*="geek"], [class*="resume"], [class*="user"], [class*="profile"], div'));
  const candidates = elements
    .filter(isActionableElement)
    .map((element) => ({
      element,
      text: getElementText(element),
      rect: element.getBoundingClientRect(),
    }))
    .filter(({ text, rect }) => {
      if (!text || text.length < 12 || text.length > 900) return false;
      if (rect.width < 180 || rect.height < 45) return false;
      if (/全部职位|新招呼|沟通中|账号权益|招聘规范|职位管理|推荐牛人/.test(text)) return false;
      if (/工作经历|项目经验|项目经历|职位详情|工作地址/.test(text) && text.length > 500) return false;
      return WORKBENCH_TEXT.candidateSummarySignal.test(text) && /(J\d+|沟通职位|本科|大专|硕士|博士|年|期望)/.test(text);
    })
    .sort((a, b) => {
      const aTop = a.rect.top < window.innerHeight * 0.32 ? 0 : 1;
      const bTop = b.rect.top < window.innerHeight * 0.32 ? 0 : 1;
      return aTop - bTop || (a.text.length - b.text.length) || (b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    });
  return candidates[0]?.element || null;
}

function extractCommunicationRole(text) {
  const match = normalizeText(text || '').match(/沟通职位[:：]\s*([^\s|，,。]+(?:\([^)]+\))?)/);
  return match ? match[1].trim() : '';
}

function extractCommunicationRoleContext(text, role) {
  const normalized = normalizeText(text || '');
  const roleText = normalizeText(role || '');
  if (!roleText) return '';
  const index = normalized.indexOf(roleText);
  if (index < 0) return '';
  return normalized.slice(Math.max(0, index - 80), index + 220);
}

function extractExpectedRole(text) {
  const match = normalizeText(text || '').match(/期望[:：]?\s*([^\s|，,。]+工程师|[^\s|，,。]+分析师|[^\s|，,。]+开发|[^\s|，,。]+运营|[^\s|，,。]+产品)/);
  return match ? match[1].trim() : '';
}

function extractChatCandidateName(panelText, bodyText) {
  const text = panelText || bodyText || '';
  const direct = extractCandidateNameFromText(text);
  if (direct) return direct;
  const match = text.match(/^([\u4e00-\u9fa5]{2,4})\s*(?:[·•]|在线|离线|\d{2}岁)/);
  if (match && isLikelyCandidateName(match[1])) return match[1];
  const compactMatch = text.match(/^([\u4e00-\u9fa5]{2,4})\s*(?:[红绿]点|[·•]|\s+)?\s*(?:在线|离线|\d{2}岁)/);
  if (compactMatch && isLikelyCandidateName(compactMatch[1])) return compactMatch[1];
  const fallback = bodyText.match(/([\u4e00-\u9fa5]{2,4})\s+(?:在线|离线)\s+\d{2}岁/);
  return fallback && isLikelyCandidateName(fallback[1]) ? fallback[1] : '';
}

function isGenericCandidateName(name) {
  return /^(候选人|牛人|求职者|用户|女士|先生|姓名|未识别|未识别姓名)$/.test(normalizeText(name || ''));
}

function cleanCandidateName(value) {
  let name = normalizeText(value || '');
  if (!name) return '';
  name = name
    .replace(/^[红绿]点/, '')
    .replace(/^\d+\s*/, '')
    .replace(/^\d{1,2}:\d{2}\s*/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s*(在线|离线|活跃|已读|未读).*$/, '')
    .replace(/\s*(沟通职位|期望|应聘|投递).*$/, '')
    .trim();
  const match = name.match(/^[\u4e00-\u9fa5]{2,4}/);
  name = match ? match[0] : name;
  return isLikelyCandidateName(name) ? name : '';
}

function isLikelyCandidateName(name) {
  const text = normalizeText(name || '');
  if (!text || isGenericCandidateName(text)) return false;
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(text)) return false;
  if (/(工程师|开发|分析|运营|产品|经理|实习|岗位|职位|简历|数据|算法|测试|前端|后端|电气|结构|工艺|平台|系统|智能|求职|招聘|在线|离线|本科|硕士|博士|大专|经验|工作|公司|项目|沟通|您好|你好|谢谢|匹配|期待)/.test(text)) return false;
  return true;
}

function extractCandidateNameFromText(text) {
  const normalized = normalizeText(text || '');
  if (!normalized) return '';
  const compact = normalized
    .replace(/^[\s\d红绿点未读已读]+/, '')
    .replace(/^\d{1,2}:\d{2}\s*/, '')
    .replace(/^牛人分析器\s*/, '')
    .trim();
  const patterns = [
    /^([\u4e00-\u9fa5]{2,4})(?=\s*(?:[·•]|在线|离线|\d{2}岁|男|女|本科|大专|硕士|博士))/,
    /^([\u4e00-\u9fa5]{2,4})(?=\s+(?:前端|后端|测试|数据|运营|产品|结构|电气|工艺|算法|嵌入式|Java|C\+\+|DevOps|SQE|PLM|ERP|具身|行业|动力|底盘|机器人))/i,
    /^([\u4e00-\u9fa5]{2,4})(?=\s+[\u4e00-\u9fa5A-Za-z/+#（）()]+(?:工程师|开发|分析|运营|产品|实习|经理|算法))/,
    /(?:^|\s)([\u4e00-\u9fa5]{2,4})(?=\s*(?:[·•]|在线|离线|\d{2}岁))/,
    /(?:姓名|候选人)[:：]\s*([\u4e00-\u9fa5]{2,4})/,
  ];
  for (const source of [compact, normalized]) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const name = cleanCandidateName(match?.[1] || '');
      if (name) return name;
    }
  }
  return '';
}

function extractEducationFromText(text) {
  const match = normalizeText(text || '').match(/(博士|硕士|本科|大专|高中|中专)/);
  return match ? match[1] : '';
}

function extractExperienceFromText(text) {
  const match = normalizeText(text || '').match(/(\d{1,2}\s*年(?:工作|开发|数据|测试|运营|产品)?经验?|\d{1,2}\s*年)/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function extractExpectedSalaryFromText(text) {
  const match = normalizeText(text || '').match(/(\d{1,3}\s*[-~到]\s*\d{1,3}\s*[kK]|面议|\d{1,3}\s*[kK])/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function extractAgeFromText(text) {
  const match = normalizeText(text || '').match(/(\d{2}\s*岁)/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function extractLatestCandidateMessage(text, name = '') {
  const normalized = normalizeText(text || '');
  const nameText = normalizeText(name || '');
  if (nameText) {
    const nameIndex = normalized.indexOf(nameText);
    const scoped = nameIndex >= 0 ? normalized.slice(nameIndex, nameIndex + 900) : normalized;
    const scopedMatch = scoped.match(/您好[，,][\s\S]{10,260}/);
    if (scopedMatch) return scopedMatch[0].slice(0, 260);
  }
  const match = normalized.match(/您好[，,][\s\S]{10,260}/);
  return match ? match[0].slice(0, 260) : '';
}

// ============================================================
// 数据存储
// ============================================================

async function saveResumeData(resumeInfo) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['resumes'], (result) => {
      const resumes = result.resumes || [];

      const existingIndex = resumes.findIndex(r => isSameResume(r, resumeInfo));
      if (existingIndex >= 0) {
        const merged = {
          ...resumes[existingIndex],
          ...resumeInfo,
          updatedAt: new Date().toISOString(),
        };
        resumes[existingIndex] = merged;
        chrome.storage.local.set({ resumes }, () => {
          chrome.runtime.sendMessage({
            action: 'syncCandidateToBackend',
            candidate: merged,
          }).catch(() => {});
          if (merged.evaluation?.suitable && hasCandidateResumeEvidence(merged) && isResumeRequestSatisfied(merged)) {
            pushCandidateRecommendation(merged);
          }
          resolve({ saved: false, duplicate: true, updated: true });
        });
        return;
      }

      resumes.unshift(resumeInfo);
      chrome.storage.local.set({ resumes }, () => {
        notifyPopup('resumeReceived', resumeInfo);
        chrome.runtime.sendMessage({
          action: 'syncCandidateToBackend',
          candidate: resumeInfo,
        }).catch(() => {});
        if (resumeInfo.evaluation?.suitable && hasCandidateResumeEvidence(resumeInfo) && isResumeRequestSatisfied(resumeInfo)) {
          pushCandidateRecommendation(resumeInfo);
        } else if (resumeInfo.evaluation?.suitable && hasCandidateResumeEvidence(resumeInfo)) {
          notifyPopup('log', {
            message: `已暂缓推荐：${resumeInfo.name || '候选人'} 尚未完成求简历`,
            type: 'warning',
          });
        }
        resolve({ saved: true, duplicate: false });
      });
    });
  });
}

async function pushCandidateRecommendation(resumeInfo) {
  if (!hasCandidateResumeEvidence(resumeInfo)) {
    notifyPopup('log', {
      message: `已跳过推荐：${resumeInfo.name || '候选人'} 尚未获取简历`,
      type: 'warning',
    });
    return;
  }
  if (!isResumeRequestSatisfied(resumeInfo)) {
    notifyPopup('log', {
      message: `已跳过推荐：${resumeInfo.name || '候选人'} 未成功求简历`,
      type: 'warning',
    });
    return;
  }
  const report = buildCandidateReport(resumeInfo);
  chrome.storage.local.get(['recommendedCandidates', 'candidateReports'], (result) => {
    const recommendedCandidates = result.recommendedCandidates || [];
    const candidateReports = result.candidateReports || [];
    const exists = recommendedCandidates.some(item => isSameResume(item, resumeInfo));
    if (exists) return;

    const summary = {
      id: resumeInfo.id,
      name: resumeInfo.name,
      role: resumeInfo.role || '待确认岗位',
      education: resumeInfo.education || '',
      experience: resumeInfo.experience || '',
      expectedSalary: resumeInfo.expectedSalary || '',
      source: resumeInfo.source || resumeInfo.accountPlatform || 'BOSS直聘',
      accountName: resumeInfo.accountName || '',
      accountPlatform: resumeInfo.accountPlatform || 'BOSS直聘',
      hasResume: true,
      hasAttachmentResume: Boolean(resumeInfo.hasAttachmentResume),
      resumeAttachmentType: resumeInfo.resumeAttachmentType || (resumeInfo.hasAttachmentResume ? 'attachment' : 'none'),
      resumeStatus: resumeInfo.resumeStatus || '已识别简历详情',
      resumeRequestRequired: Boolean(resumeInfo.resumeRequestRequired),
      resumeRequestExecuted: Boolean(resumeInfo.resumeRequestExecuted),
      resumeRequestStatus: resumeInfo.resumeRequestStatus || '',
      resumeRequestError: resumeInfo.resumeRequestError || '',
      resumeRequestAt: resumeInfo.resumeRequestAt || '',
      resumeRequestButtonText: resumeInfo.resumeRequestButtonText || '',
      resumeRequestMethod: resumeInfo.resumeRequestMethod || '',
      resumeRequestMessage: resumeInfo.resumeRequestMessage || '',
      resumeRequestFallbackReason: resumeInfo.resumeRequestFallbackReason || '',
      score: resumeInfo.evaluation.score,
      recommendation: resumeInfo.evaluation.recommendation,
      nextStep: resumeInfo.evaluation.nextStep,
      strengths: resumeInfo.evaluation.strengths,
      risks: resumeInfo.evaluation.risks,
      sourceUrl: resumeInfo.sourceUrl,
      jobRequirement: resumeInfo.jobRequirement || '',
      rejectionReasons: resumeInfo.evaluation.rejectionReasons || [],
      pushedAt: new Date().toISOString(),
    };

    recommendedCandidates.unshift(summary);
    candidateReports.unshift({
      id: resumeInfo.id,
      name: resumeInfo.name,
      role: resumeInfo.role || '待确认岗位',
      report,
      createdAt: new Date().toISOString(),
    });

    chrome.storage.local.set({
      recommendedCandidates,
      candidateReports,
    }, () => {
      chrome.runtime.sendMessage({
        action: 'pushCandidateRecommendation',
        candidate: summary,
        report,
      }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'syncRecommendationToBackend',
        candidate: summary,
        report,
      }).catch(() => {});
      notifyPopup('candidateRecommended', summary);
    });
  });
}

function hasCandidateResumeEvidence(info) {
  if (!info || info.hasResume === false || info.resumeStatus === '仅沟通信息') return false;
  const id = String(info.id || '');
  if (id.startsWith('chat_') && !info.hasResume) return false;
  return Boolean(
    info.hasResume ||
    info.resumeStatus ||
    info.topLevelText ||
    info.education ||
    info.experience ||
    info.summary ||
    info.rawText
  );
}

function isResumeRequestSatisfied(info) {
  if (!info) return false;
  if (info.hasAttachmentResume) return true;
  const score = Number(info.evaluation?.score || info.score || 0);
  if (score < AGENTS_EVALUATION_RULES.recommendThreshold) return true;
  return Boolean(
    info.resumeRequestExecuted ||
    /已点击求简历|已索要简历|已发送求简历消息/.test(String(info.resumeRequestStatus || ''))
  );
}

function buildCandidateReport(info) {
  const evaluation = info.evaluation || evaluateCandidate(info);
  const dimensions = evaluation.dimensions || {};
  const mark = {
    match: '✅',
    partial: '⚠️',
    weak: '❌',
  };
  const stars = evaluation.score >= 80 ? '⭐⭐⭐' : evaluation.score >= 60 ? '⭐⭐' : evaluation.score >= 40 ? '⭐' : '❌';

  return [
    `## 📋 ${info.role || '待确认岗位'} - ${info.name || '候选人'}`,
    '',
    '### 候选人概况',
    '| 项目 | 信息 |',
    '|------|------|',
    `| 姓名 | ${info.name || '未识别'} |`,
    `| 学历 | ${info.education || '未识别'} |`,
    `| 工作年限 | ${info.experience || '未识别'} |`,
    `| 当前状态 | ${info.status || '未识别'} |`,
    `| 申请职位 | ${info.role || '待确认'} |`,
    `| 期望薪资 | ${info.expectedSalary || '未识别'} |`,
    `| 数据来源 | ${info.source || info.accountPlatform || 'BOSS直聘'} |`,
    `| 账号信息 | ${info.accountName || '未配置'} |`,
    `| 岗位要求 | ${info.jobRequirement ? info.jobRequirement.slice(0, 120) : '未抓取到岗位JD'} |`,
    '',
    '### 匹配度分析',
    '| 要求项 | 权重 | 匹配情况 | 候选人条件 |',
    '|--------|------|----------|------------|',
    `| 学历/硬性条件 | 20% | ${mark[dimensions.hard?.match] || '⚠️'} | ${info.education || info.experience || '信息不足'} |`,
    `| 技术栈 | 30% | ${mark[dimensions.skills?.match] || '⚠️'} | ${(dimensions.skills?.matchedKeywords || []).slice(0, 8).join('、') || '待确认'} |`,
    `| 项目经验 | 30% | ${mark[dimensions.projects?.match] || '⚠️'} | ${info.summary || '待确认项目深度'} |`,
    `| 薪资期望 | 20% | ${mark[dimensions.salary?.match] || '⚠️'} | ${info.expectedSalary || '待沟通'} |`,
    `| 岗位JD匹配 | 校准项 | ${mark[dimensions.jd?.match] || '⚠️'} | 匹配：${(dimensions.jd?.matched || []).slice(0, 6).join('、') || '暂无'}；缺失：${(dimensions.jd?.missing || []).slice(0, 6).join('、') || '暂无'} |`,
    '',
    `**综合匹配度：${stars} (${evaluation.score}%)**`,
    '',
    '### 优势',
    ...(evaluation.strengths.length ? evaluation.strengths.map(item => `- ✅ ${item}`) : ['- 暂无明显优势信号，需补充简历信息']),
    '',
    '### 劣势/风险',
    ...(evaluation.risks.length ? evaluation.risks.map(item => `- ⚠️ ${item}`) : ['- 暂无明显风险信号']),
    '',
    '### 推荐意见',
    `**${evaluation.recommendation}**`,
    ...(evaluation.recommendation === '不推荐' ? [
      '',
      '### 不推荐依据',
      ...(evaluation.rejectionReasons?.length ? evaluation.rejectionReasons.map(item => `- ${item}`) : ['- 综合匹配度低于推荐阈值，且岗位关键要求体现不足']),
    ] : []),
    '',
    '### 下一步行动建议',
    `- [ ] ${evaluation.nextStep}`,
    '- [ ] 核对学历、年限、薪资与JD要求',
    '- [ ] 面试中深挖项目职责、技术深度和量化成果',
  ].join('\n');
}

// ============================================================
// 通知 popup
// ============================================================

function notifyPopup(action, data) {
  try {
    chrome.runtime.sendMessage({ action, ...data }).catch(() => {});
  } catch (e) {}
}

// ============================================================
// 消息监听
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'settingsChanged') {
    settings = { ...settings, ...message.settings };
    sendResponse({ success: true });
  }

  if (message.action === 'scanPage') {
    scanCurrentPage({ notify: true }).then(sendResponse);
    return true;
  }

  if (message.action === 'checkNewResumes') {
    scanCurrentPage({ notify: false }).then(sendResponse);
    return true;
  }

  if (message.action === 'runResumeActions') {
    runResumeActions({
      scope: document,
      contextName: '当前页面',
      manual: true,
    }).then(sendResponse);
    return true;
  }

  if (message.action === 'browseCandidatesAndRunActions') {
    browseCandidatesAndRunActions({
      manual: true,
      maxCandidates: message.maxCandidates || 10,
    }).then(sendResponse);
    return true;
  }

  if (message.action === 'startRecruitmentWorkflow') {
    startRecruitmentWorkflow({
      maxCandidates: message.maxCandidates || settings.maxCandidatesPerRun || 20,
    }).then(sendResponse);
    return true;
  }

  if (message.action === 'getSafetyStatus') {
    resetCountersIfNeeded();
    const actionTargets = findActionTargets(document);
    const browseTargets = findCandidateNavigationTargets();
    const accountInfo = detectRecruiterAccountInfo();
    sendResponse({
      isDegraded: safetyState.isDegraded,
      operationCount,
      settings,
      accountInfo,
      page: {
        url: window.location.href,
        cardCount: findResumeCards().length,
        browseCount: browseTargets.length,
        actionCount: actionTargets.length,
        actions: actionTargets.map(item => ({
          type: item.type,
          label: item.label,
          text: item.text,
        })),
      },
    });
  }

  if (message.action === 'resetSafety') {
    safetyState.isDegraded = false;
    safetyState.consecutiveErrors = 0;
    operationCount.today = 0;
    operationCount.hourly = 0;
    chrome.storage.local.set({ safetyState, operationCount });
    sendResponse({ success: true });
  }

  return true;
});

// ============================================================
// 启动
// ============================================================

init();
