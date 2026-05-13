# 招聘助手 Web 管理后台部署

## CI/CD 自动部署

仓库已提供 GitHub Actions 流水线：

```text
.github/workflows/ci-cd.yml
```

代码提交到 `main` 后会自动执行：

1. 拉取代码。
2. 校验 Python 后端和浏览器插件脚本。
3. 打包浏览器插件 zip。
4. 构建并推送 Web 后台 Docker 镜像到 GHCR。
5. 配置生产 SSH secrets 后自动部署到服务器。
6. 调用 `/api/health` 监控部署状态。
7. 构建或部署失败时通过钉钉通知。

完整配置见仓库根目录：

```text
docs/CICD_DEPLOYMENT.md
```

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

## 生产镜像部署

```bash
cd /opt/hrassistant
IMAGE_TAG=latest ./scripts/deploy-production.sh
```

健康检查：

```bash
./scripts/check-production.sh http://127.0.0.1:8787
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
- 数据推送范围（昨日、今日、近7天或自定义开始/结束时间）
- 公开访问地址（用于钉钉消息中的 Excel 推荐表下载链接）

每日定时推送会按 Web GUI 中配置的时间范围生成汇总，并使用 `templates/定时推送候选人推荐表模板.xlsx` 生成 Excel 推荐表。推荐表只包含已识别到简历证据且达到推荐阈值的候选人，未获取简历的沟通候选人不会进入推荐明细。

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
