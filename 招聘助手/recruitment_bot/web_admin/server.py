#!/usr/bin/env python3
"""
招聘助手 Web 管理后台与 API 服务

功能：
- 保存浏览器插件同步的候选人、推荐摘要、Markdown 报告
- 提供 Web GUI 查看历史数据、配置钉钉、问答 Agent
- 接收钉钉回调并根据历史数据回答
- 定时任务由外部 cron 调用 /api/summary/push?scope=yesterday
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
import urllib.parse
import urllib.request
import threading
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DB_PATH = Path(os.environ.get("RECRUITMENT_DB", ROOT / "recruitment_history.db"))
HOST = os.environ.get("RECRUITMENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("RECRUITMENT_PORT", "8787"))


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def date_str(offset_days: int = 0) -> str:
    return (datetime.now() + timedelta(days=offset_days)).date().isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS candidates (
                id TEXT PRIMARY KEY,
                name TEXT,
                role TEXT,
                source TEXT,
                account_name TEXT,
                account_platform TEXT,
                education TEXT,
                experience TEXT,
                expected_salary TEXT,
                score INTEGER,
                recommendation TEXT,
                received_date TEXT,
                raw_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recommendations (
                id TEXT PRIMARY KEY,
                candidate_id TEXT,
                name TEXT,
                role TEXT,
                source TEXT,
                account_name TEXT,
                score INTEGER,
                recommendation TEXT,
                next_step TEXT,
                raw_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                candidate_id TEXT,
                name TEXT,
                role TEXT,
                report TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )


def json_response(handler: SimpleHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler: SimpleHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def upsert_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    candidate_id = str(candidate.get("id") or hashlib.sha1(json.dumps(candidate, ensure_ascii=False).encode()).hexdigest())
    evaluation = candidate.get("evaluation") or {}
    with connect() as conn:
        existing = conn.execute("SELECT id FROM candidates WHERE id = ?", (candidate_id,)).fetchone()
        created_at = now_iso()
        if existing:
            created_at = conn.execute("SELECT created_at FROM candidates WHERE id = ?", (candidate_id,)).fetchone()["created_at"]
        conn.execute(
            """
            INSERT OR REPLACE INTO candidates
            (id, name, role, source, account_name, account_platform, education, experience,
             expected_salary, score, recommendation, received_date, raw_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                candidate_id,
                candidate.get("name", ""),
                candidate.get("role", ""),
                candidate.get("source", ""),
                candidate.get("accountName", ""),
                candidate.get("accountPlatform", ""),
                candidate.get("education", ""),
                candidate.get("experience", ""),
                candidate.get("expectedSalary", ""),
                int(evaluation.get("score") or 0),
                evaluation.get("recommendation", ""),
                candidate.get("receivedDate", date_str()),
                json.dumps(candidate, ensure_ascii=False),
                created_at,
                now_iso(),
            ),
        )
    return {"success": True, "id": candidate_id}


def save_recommendation(candidate: dict[str, Any], report: str = "") -> dict[str, Any]:
    candidate_id = str(candidate.get("id") or candidate.get("candidate_id") or hashlib.sha1(json.dumps(candidate, ensure_ascii=False).encode()).hexdigest())
    rec_id = hashlib.sha1(f"{candidate_id}:{candidate.get('pushedAt') or now_iso()}".encode()).hexdigest()
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO recommendations
            (id, candidate_id, name, role, source, account_name, score, recommendation, next_step, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec_id,
                candidate_id,
                candidate.get("name", ""),
                candidate.get("role", ""),
                candidate.get("source", ""),
                candidate.get("accountName", ""),
                int(candidate.get("score") or 0),
                candidate.get("recommendation", ""),
                candidate.get("nextStep", ""),
                json.dumps(candidate, ensure_ascii=False),
                candidate.get("pushedAt") or now_iso(),
            ),
        )
        if report:
            report_id = hashlib.sha1(f"{candidate_id}:report:{report[:80]}".encode()).hexdigest()
            conn.execute(
                """
                INSERT OR REPLACE INTO reports
                (id, candidate_id, name, role, report, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (report_id, candidate_id, candidate.get("name", ""), candidate.get("role", ""), report, now_iso()),
            )
    return {"success": True, "id": rec_id}


def list_rows(table: str, limit: int = 200, date_field: str | None = None, date_value: str | None = None) -> list[dict[str, Any]]:
    allowed = {"candidates", "recommendations", "reports"}
    if table not in allowed:
        raise ValueError("invalid table")
    sql = f"SELECT * FROM {table}"
    params: list[Any] = []
    if date_field and date_value:
        sql += f" WHERE {date_field} LIKE ?"
        params.append(f"{date_value}%")
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def get_settings() -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    result: dict[str, Any] = {}
    for row in rows:
        try:
            result[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            result[row["key"]] = row["value"]
    return result


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    with connect() as conn:
        for key, value in payload.items():
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
                (key, json.dumps(value, ensure_ascii=False), now_iso()),
            )
    return {"success": True}


def scheduled_push_loop() -> None:
    while True:
        try:
            settings = get_settings()
            enabled = bool(settings.get("scheduledPushEnabled"))
            push_time = str(settings.get("scheduledPushTime") or "10:00")
            last_date = str(settings.get("scheduledPushLastDate") or "")
            today = date_str()
            if enabled and last_date != today and datetime.now().strftime("%H:%M") == push_time:
                markdown = build_summary("yesterday")
                result = send_dingtalk_markdown("招聘助手昨日候选人汇总", markdown)
                if result.get("success"):
                    save_settings({"scheduledPushLastDate": today})
        except Exception as exc:
            print(f"[scheduled_push] {exc}")
        time.sleep(60)


def dingtalk_signed_url(webhook: str, secret: str = "") -> str:
    if not secret:
        return webhook
    timestamp = str(int(time.time() * 1000))
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), string_to_sign, hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest).decode("utf-8"))
    separator = "&" if "?" in webhook else "?"
    return f"{webhook}{separator}timestamp={timestamp}&sign={sign}"


def send_dingtalk_markdown(title: str, text: str) -> dict[str, Any]:
    settings = get_settings()
    webhook = str(settings.get("dingtalkWebhook") or "")
    secret = str(settings.get("dingtalkSecret") or "")
    if not webhook:
        return {"success": False, "message": "钉钉 Webhook 未配置"}
    return send_dingtalk_markdown_to_webhook(webhook, title, text, secret)


def send_dingtalk_markdown_to_webhook(webhook: str, title: str, text: str, secret: str = "") -> dict[str, Any]:
    url = dingtalk_signed_url(webhook, secret)
    data = json.dumps({"msgtype": "markdown", "markdown": {"title": title, "text": text}}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode("utf-8") or "{}")
    if body.get("errcode") not in (None, 0):
        return {"success": False, "message": body.get("errmsg", "钉钉推送失败"), "body": body}
    return {"success": True, "body": body}


def parse_dingtalk_message(payload: dict[str, Any]) -> dict[str, Any]:
    """兼容钉钉普通 HTTP 回调与 Stream 包装格式。"""
    if isinstance(payload.get("data"), str):
        try:
            inner = json.loads(payload["data"])
            if isinstance(inner, dict):
                payload = inner
        except json.JSONDecodeError:
            pass

    text = ""
    text_obj = payload.get("text")
    if isinstance(text_obj, dict):
        text = str(text_obj.get("content") or "")
    elif isinstance(text_obj, str):
        text = text_obj
    if not text:
        text = str(payload.get("content") or payload.get("message") or "")

    at_users = payload.get("atUsers") or []
    if isinstance(at_users, list):
        for user in at_users:
            if isinstance(user, dict):
                text = text.replace(str(user.get("dingtalkId") or ""), "")
                text = text.replace(str(user.get("staffId") or ""), "")

    return {
        "question": text.strip(),
        "sessionWebhook": payload.get("sessionWebhook") or "",
        "senderNick": payload.get("senderNick") or "",
        "conversationTitle": payload.get("conversationTitle") or "",
        "msgtype": payload.get("msgtype") or "text",
        "raw": payload,
    }


def dingtalk_callback_ack() -> dict[str, Any]:
    """钉钉 Stream HTTP 推送要求成功响应结构；普通回调也可接受。"""
    return {
        "code": 200,
        "headers": {
            "contentType": "application/json",
            "messageId": f"recruitment_{int(time.time() * 1000)}",
        },
        "message": "OK",
        "data": json.dumps({"response": None}, ensure_ascii=False),
    }


def handle_dingtalk_conversation(payload: dict[str, Any]) -> dict[str, Any]:
    message = parse_dingtalk_message(payload)
    question = message["question"]
    if not question:
        answer = "### 招聘助手\n\n我没有收到有效问题。你可以问：昨天推荐了谁？React候选人有哪些？匹配度最高的是谁？"
    else:
        answer = answer_question(question)

    webhook = message.get("sessionWebhook")
    if webhook:
        push_result = send_dingtalk_markdown_to_webhook(
            webhook,
            "招聘助手问答",
            answer,
            "",
        )
    else:
        push_result = send_dingtalk_markdown("招聘助手问答", answer)

    return {
        "success": True,
        "question": question,
        "answer": answer,
        "reply": push_result,
        "ack": dingtalk_callback_ack(),
    }


def build_summary(scope: str = "all") -> str:
    target_date = date_str(-1) if scope == "yesterday" else None
    candidates = list_rows("candidates", limit=1000, date_field="received_date", date_value=target_date)
    recommendations = list_rows("recommendations", limit=1000, date_field="created_at", date_value=target_date)
    settings = get_settings()
    source_counts: dict[str, int] = {}
    for item in candidates:
        source = item.get("source") or "未知来源"
        source_counts[source] = source_counts.get(source, 0) + 1
    source_text = "，".join(f"{k} {v}份" for k, v in source_counts.items()) or "暂无"
    rows = [
        f"| {idx + 1} | {item.get('name','')} | {item.get('role','')} | {item.get('score',0)}% | {item.get('recommendation','')} | {item.get('source','')} | {item.get('account_name') or settings.get('accountName','未识别')} | {item.get('next_step','')} |"
        for idx, item in enumerate(recommendations[:30])
    ]
    title_date = target_date or "全部历史"
    return "\n".join(
        [
            f"### {title_date} 招聘数据汇总",
            "",
            f"- 数据来源：{source_text}",
            f"- 候选人数量：{len(candidates)}",
            f"- 推荐候选人：{len(recommendations)}",
            "",
            "| 序号 | 姓名 | 申请职位 | 匹配度 | 推荐意见 | 数据来源 | 账号信息 | 下一步 |",
            "|------|------|----------|--------|----------|----------|----------|--------|",
            *(rows or ["| - | 暂无 | - | - | - | - | - | - |"]),
        ]
    )


def answer_question(question: str) -> str:
    question = question.strip()
    if not question:
        return "请提出一个和招聘历史数据有关的问题。"
    today = date_str()
    scope_date = today if ("今天" in question or "今日" in question) else None
    candidates = list_rows("candidates", limit=1000, date_field="received_date", date_value=scope_date)
    recommendations = list_rows("recommendations", limit=1000, date_field="created_at", date_value=scope_date)
    if any(word in question for word in ["汇总", "统计", "多少", "数量"]):
        return f"### 招聘助手答复\n\n- 候选人数量：{len(candidates)}\n- 推荐候选人：{len(recommendations)}\n- 查询范围：{'今日' if scope_date else '全部历史'}"
    cleaned = question
    for word in ["今天", "今日", "昨天", "昨日", "候选人", "推荐", "简历", "哪些", "哪个", "有没有", "最高", "匹配度", "统计", "汇总"]:
        cleaned = cleaned.replace(word, " ")
    keywords = [word for word in cleaned.replace("？", " ").replace("?", " ").split() if len(word) >= 2]
    rows = recommendations or candidates
    if keywords:
        rows = [
            row for row in rows
            if any(keyword.lower() in json.dumps(dict(row), ensure_ascii=False).lower() for keyword in keywords)
        ]
    rows = sorted(rows, key=lambda row: row.get("score") or 0, reverse=True)
    if not rows:
        return f"### 招聘助手答复\n\n没有找到和“{question}”匹配的历史候选人。"
    lines = [
        f"{idx + 1}. {row.get('name','未识别')}｜{row.get('role','待确认')}｜{row.get('score',0)}%｜{row.get('recommendation','待评估')}"
        for idx, row in enumerate(rows[:10])
    ]
    return "### 招聘助手答复\n\n" + "\n".join(lines)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urllib.parse.urlparse(path)
        if parsed.path == "/":
            return str(STATIC_DIR / "index.html")
        return str(STATIC_DIR / parsed.path.lstrip("/"))

    def do_OPTIONS(self) -> None:
        json_response(self, {"success": True})

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/health":
                json_response(self, {"success": True, "time": now_iso()})
            elif parsed.path == "/api/settings":
                json_response(self, get_settings())
            elif parsed.path == "/api/candidates":
                json_response(self, {"items": list_rows("candidates", int(query.get("limit", ["200"])[0]))})
            elif parsed.path == "/api/recommendations":
                json_response(self, {"items": list_rows("recommendations", int(query.get("limit", ["200"])[0]))})
            elif parsed.path == "/api/reports":
                json_response(self, {"items": list_rows("reports", int(query.get("limit", ["100"])[0]))})
            elif parsed.path == "/api/summary":
                scope = query.get("scope", ["all"])[0]
                json_response(self, {"markdown": build_summary(scope)})
            else:
                super().do_GET()
        except Exception as exc:
            json_response(self, {"success": False, "message": str(exc)}, 500)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = read_json(self)
            if parsed.path == "/api/settings":
                json_response(self, save_settings(payload))
            elif parsed.path == "/api/candidates":
                json_response(self, upsert_candidate(payload))
            elif parsed.path == "/api/recommendations":
                json_response(self, save_recommendation(payload.get("candidate", payload), payload.get("report", "")))
            elif parsed.path == "/api/agent/ask":
                answer = answer_question(str(payload.get("question", "")))
                if payload.get("replyToDingTalk"):
                    send_dingtalk_markdown("招聘助手问答", answer)
                json_response(self, {"success": True, "answer": answer})
            elif parsed.path == "/api/dingtalk/test":
                json_response(self, send_dingtalk_markdown("招聘助手钉钉连接测试", "### 招聘助手钉钉连接测试\n\n连接成功。"))
            elif parsed.path == "/api/summary/push":
                scope = urllib.parse.parse_qs(parsed.query).get("scope", ["yesterday"])[0]
                markdown = build_summary(scope)
                json_response(self, send_dingtalk_markdown("招聘助手候选人汇总", markdown))
            elif parsed.path == "/api/dingtalk/callback":
                result = handle_dingtalk_conversation(payload)
                if payload.get("data") is not None:
                    json_response(self, result["ack"])
                else:
                    json_response(self, result)
            elif parsed.path == "/api/dingtalk/callback-test":
                question = str(payload.get("question") or "")
                answer = answer_question(question)
                json_response(self, {"success": True, "question": question, "answer": answer})
            else:
                json_response(self, {"success": False, "message": "not found"}, 404)
        except Exception as exc:
            json_response(self, {"success": False, "message": str(exc)}, 500)


def main() -> None:
    init_db()
    threading.Thread(target=scheduled_push_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"招聘助手 Web 管理后台已启动: http://127.0.0.1:{PORT}")
    print(f"数据文件: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
