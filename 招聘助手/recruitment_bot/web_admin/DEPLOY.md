# 招聘助手 Web 管理后台部署

## 本地启动

```bash
cd /Users/youluzhineng/Desktop/zhaopin/招聘助手/recruitment_bot/web_admin
python3 server.py
```

打开：

```text
http://127.0.0.1:8787
```

浏览器插件的 `Web 后端地址` 填：

```text
http://127.0.0.1:8787
```

## Docker 部署

```bash
cd /Users/youluzhineng/Desktop/zhaopin/招聘助手/recruitment_bot/web_admin
docker compose up -d --build
```

数据保存在：

```text
recruitment_bot/web_admin/data/recruitment_history.db
```

## 公网部署

1. 将 `web_admin` 目录复制到服务器。
2. 用 Docker Compose 启动。
3. 用 Nginx/Caddy/宝塔把域名反向代理到 `127.0.0.1:8787`。
4. 浏览器插件的 `Web 后端地址` 填公网 HTTPS 地址，例如：

```text
https://hr.example.com
```

## 钉钉机器人配置

在 Web GUI 中填写：

- 钉钉 Webhook
- 加签 Secret
- 账号信息
- 每日推送时间

每日定时推送会推送“前一天”的招聘数据汇总。

## 钉钉问答 Agent 回调

在钉钉机器人回调中配置：

```text
https://你的域名/api/dingtalk/callback
```

接口会读取钉钉消息文本，并基于 SQLite 中的历史候选人、推荐、报告数据生成答复。

如果钉钉回调 payload 中带有 `sessionWebhook`，服务会优先使用该地址回复当前会话；否则使用 Web GUI 中配置的钉钉机器人 Webhook 推送答复。

本地可用以下接口测试 Agent 回答，不会推送钉钉：

```bash
curl -X POST http://127.0.0.1:8787/api/dingtalk/callback-test \
  -H 'Content-Type: application/json' \
  -d '{"question":"昨天推荐了谁"}'
```

模拟钉钉普通 HTTP 回调：

```bash
curl -X POST http://127.0.0.1:8787/api/dingtalk/callback \
  -H 'Content-Type: application/json' \
  -d '{"text":{"content":"React候选人有哪些"},"senderNick":"HR"}'
```

注意：如果没有 `sessionWebhook`，需要先在 Web GUI 配置钉钉 Webhook，否则无法把答案推回钉钉群。

## API

- `POST /api/candidates` 保存候选人
- `POST /api/recommendations` 保存推荐和报告
- `GET /api/candidates` 查询候选人
- `GET /api/recommendations` 查询推荐
- `POST /api/agent/ask` 历史数据问答
- `POST /api/dingtalk/callback` 钉钉回调
- `POST /api/summary/push?scope=yesterday` 推送昨日汇总
