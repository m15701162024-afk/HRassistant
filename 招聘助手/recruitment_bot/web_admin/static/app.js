const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.message || '请求失败');
  }
  return data;
}

function text(value) {
  return value == null ? '' : String(value);
}

function row(cells) {
  return `<tr>${cells.map(cell => `<td>${escapeHtml(text(cell))}</td>`).join('')}</tr>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

async function loadSettings() {
  const settings = await api('/api/settings');
  $('dingtalkWebhook').value = settings.dingtalkWebhook || '';
  $('dingtalkSecret').value = settings.dingtalkSecret || '';
  $('accountName').value = settings.accountName || '';
  $('scheduledPushTime').value = settings.scheduledPushTime || '10:00';
  $('toggleScheduleBtn').textContent = settings.scheduledPushEnabled ? '关闭定时推送' : '开启定时推送';
  $('callbackUrl').textContent = `${location.origin}/api/dingtalk/callback`;
}

async function saveSettings() {
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      dingtalkWebhook: $('dingtalkWebhook').value.trim(),
      dingtalkSecret: $('dingtalkSecret').value.trim(),
      accountName: $('accountName').value.trim(),
      scheduledPushTime: $('scheduledPushTime').value || '10:00',
    }),
  });
  alert('配置已保存');
}

async function toggleSchedule() {
  const settings = await api('/api/settings');
  await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      dingtalkWebhook: $('dingtalkWebhook').value.trim(),
      dingtalkSecret: $('dingtalkSecret').value.trim(),
      accountName: $('accountName').value.trim(),
      scheduledPushTime: $('scheduledPushTime').value || '10:00',
      scheduledPushEnabled: !settings.scheduledPushEnabled,
    }),
  });
  await loadSettings();
}

async function loadData() {
  const [candidates, recommendations, reports] = await Promise.all([
    api('/api/candidates?limit=500'),
    api('/api/recommendations?limit=500'),
    api('/api/reports?limit=100'),
  ]);

  $('candidateCount').textContent = candidates.items.length;
  $('recommendationCount').textContent = recommendations.items.length;
  $('reportCount').textContent = reports.items.length;

  $('candidateRows').innerHTML = candidates.items.map(item => row([
    item.received_date,
    item.name,
    item.role,
    item.education,
    item.experience,
    item.expected_salary,
    item.source,
    item.account_name,
  ])).join('') || row(['-', '暂无数据', '-', '-', '-', '-', '-', '-']);

  $('recommendationRows').innerHTML = recommendations.items.map(item => row([
    item.name,
    item.role,
    `${item.score || 0}%`,
    item.recommendation,
    item.source,
    item.account_name,
    item.next_step,
  ])).join('') || row(['暂无数据', '-', '-', '-', '-', '-', '-']);

  $('reportList').innerHTML = reports.items.slice(0, 20).map(item => `
    <article class="report">
      <h3>${escapeHtml(item.name || '候选人')} - ${escapeHtml(item.role || '待确认')}</h3>
      <pre>${escapeHtml(item.report || '')}</pre>
    </article>
  `).join('') || '<p>暂无报告</p>';
}

async function ask(replyToDingTalk = false) {
  const question = $('questionInput').value.trim();
  if (!question) {
    alert('请输入问题');
    return;
  }
  $('answerBox').textContent = 'Agent 正在查询历史数据...';
  const result = await api('/api/agent/ask', {
    method: 'POST',
    body: JSON.stringify({ question, replyToDingTalk }),
  });
  $('answerBox').textContent = result.answer;
}

async function testDingTalk() {
  await saveSettings();
  const result = await api('/api/dingtalk/test', { method: 'POST', body: '{}' });
  alert(result.success ? '钉钉测试消息已发送' : result.message);
}

async function pushYesterday() {
  const result = await api('/api/summary/push?scope=yesterday', { method: 'POST', body: '{}' });
  alert(result.success ? '昨日汇总已推送' : result.message);
}

$('refreshBtn').addEventListener('click', loadData);
$('saveSettingsBtn').addEventListener('click', saveSettings);
$('toggleScheduleBtn').addEventListener('click', toggleSchedule);
$('testDingTalkBtn').addEventListener('click', testDingTalk);
$('pushYesterdayBtn').addEventListener('click', pushYesterday);
$('askBtn').addEventListener('click', () => ask(false));
$('askAndPushBtn').addEventListener('click', () => ask(true));

loadSettings().then(loadData).catch(err => {
  $('answerBox').textContent = `加载失败：${err.message}`;
});
