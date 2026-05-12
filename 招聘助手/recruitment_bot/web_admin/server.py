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
import csv
import hashlib
import hmac
import io
import json
import os
import sqlite3
import time
import urllib.parse
import urllib.request
import threading
import uuid
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DB_PATH = Path(os.environ.get("RECRUITMENT_DB", ROOT / "recruitment_history.db"))
HOST = os.environ.get("RECRUITMENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("RECRUITMENT_PORT", "8787"))

DEFAULT_BEHAVIOR_POLICY: dict[str, Any] = {
    "behaviorPolicyEnabled": True,
    "workTimeEnabled": False,
    "workStartTime": "09:00",
    "workEndTime": "18:00",
    "workDays": [1, 2, 3, 4, 5],
    "requestDelayMin": 5000,
    "requestDelayMax": 15000,
    "detailDwellMin": 10000,
    "detailDwellMax": 30000,
    "actionDwellMin": 8000,
    "actionDwellMax": 18000,
    "scrollMode": "mixed",
    "dailyLimit": 20,
    "hourlyLimit": 6,
    "maxCandidatesPerRun": 5,
    "browseProbability": 0.55,
    "longBreakEvery": 3,
    "longBreakMin": 60000,
    "longBreakMax": 150000,
    "interactionModes": {
        "manualPage": 40,
        "detailClick": 35,
        "filterReview": 25,
    },
    "searchKeywordPool": [
        "Java开发 北京 25-35K",
        "前端工程师 React 上海",
        "Python 后端 杭州",
        "测试开发 深圳 20-30K",
    ],
}

DEFAULT_LLM_CONFIG: dict[str, Any] = {
    "llmEnabled": False,
    "llmProvider": "openai",
    "llmProtocol": "openai-chat",
    "llmApiBase": "",
    "llmModel": "",
    "llmTemperature": 0.2,
    "llmMaxContextItems": 80,
    "llmMaxTokens": 1000,
}

LLM_PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "openai": {
        "label": "OpenAI",
        "protocol": "openai-chat",
        "apiBase": "",
        "model": "",
    },
    "claude": {
        "label": "Claude",
        "protocol": "anthropic-messages",
        "apiBase": "https://api.anthropic.com/v1",
        "model": "",
    },
    "qwen": {
        "label": "通义千问",
        "protocol": "openai-chat",
        "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "",
    },
    "aliyun": {
        "label": "阿里云百炼",
        "protocol": "openai-chat",
        "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "",
    },
    "siliconflow": {
        "label": "硅基流动",
        "protocol": "openai-chat",
        "apiBase": "https://api.siliconflow.cn/v1",
        "model": "",
    },
    "deepseek": {
        "label": "DeepSeek",
        "protocol": "openai-chat",
        "apiBase": "https://api.deepseek.com/v1",
        "model": "",
    },
    "custom": {
        "label": "自定义 OpenAI-compatible",
        "protocol": "openai-chat",
        "apiBase": "",
        "model": "",
    },
}


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

            CREATE TABLE IF NOT EXISTS agent_conversations (
                id TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                sender TEXT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                raw_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS job_requirements (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                normalized_role TEXT NOT NULL UNIQUE,
                source TEXT,
                account_name TEXT,
                requirement TEXT NOT NULL,
                source_url TEXT,
                raw_json TEXT,
                created_at TEXT NOT NULL,
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


def text_response(
    handler: SimpleHTTPRequestHandler,
    body: str,
    status: int = 200,
    content_type: str = "text/plain; charset=utf-8",
    filename: str | None = None,
) -> None:
    data = body.encode("utf-8-sig")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Access-Control-Allow-Origin", "*")
    if filename:
        handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


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


def normalize_role(role: str) -> str:
    return "".join(str(role or "").lower().split())


def upsert_job_requirement(payload: dict[str, Any]) -> dict[str, Any]:
    role = str(payload.get("role") or "").strip()
    requirement = str(payload.get("requirement") or payload.get("jobRequirement") or "").strip()
    if not role:
        return {"success": False, "message": "岗位名称不能为空"}
    if not requirement or len(requirement) < 20:
        return {"success": False, "message": "岗位要求内容过短，未保存"}
    normalized = normalize_role(role)
    item_id = hashlib.sha1(normalized.encode()).hexdigest()
    now = now_iso()
    with connect() as conn:
        existing = conn.execute(
            "SELECT created_at FROM job_requirements WHERE normalized_role = ?",
            (normalized,),
        ).fetchone()
        conn.execute(
            """
            INSERT OR REPLACE INTO job_requirements
            (id, role, normalized_role, source, account_name, requirement, source_url, raw_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                role,
                normalized,
                payload.get("source", ""),
                payload.get("accountName", ""),
                requirement[:12000],
                payload.get("sourceUrl", ""),
                json.dumps(payload, ensure_ascii=False),
                existing["created_at"] if existing else now,
                now,
            ),
        )
    matched = match_candidates_with_job_requirements()
    return {"success": True, "id": item_id, "matchedCandidates": matched["updated"]}


def get_job_requirement(role: str) -> dict[str, Any] | None:
    normalized = normalize_role(role)
    if not normalized:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM job_requirements WHERE normalized_role = ?",
            (normalized,),
        ).fetchone()
        if row:
            return dict(row)
        loose = conn.execute(
            "SELECT * FROM job_requirements WHERE normalized_role LIKE ? OR ? LIKE '%' || normalized_role || '%' ORDER BY updated_at DESC LIMIT 1",
            (f"%{normalized}%", normalized),
        ).fetchone()
        return dict(loose) if loose else None


def list_job_requirements(limit: int = 200) -> list[dict[str, Any]]:
    with connect() as conn:
        return [
            dict(row) for row in conn.execute(
                "SELECT * FROM job_requirements ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        ]


def extract_requirement_keywords_backend(text: str) -> list[str]:
    normalized = str(text or "").lower()
    keywords = [
        "java", "spring", "springboot", "mysql", "redis", "python", "django", "flask",
        "go", "golang", "react", "vue", "typescript", "javascript", "node", "测试",
        "自动化", "selenium", "playwright", "性能", "运维", "kubernetes", "docker",
        "算法", "数据", "产品", "项目管理", "招聘", "销售", "客服", "运营",
    ]
    return [item for item in keywords if item in normalized]


def match_candidate_with_requirement(candidate: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    raw: dict[str, Any]
    try:
        raw = json.loads(candidate.get("raw_json") or "{}")
    except Exception:
        raw = {}

    requirement = str(job.get("requirement") or "")
    resume_text = " ".join(
        str(value or "") for value in [
            candidate.get("name"), candidate.get("role"), candidate.get("education"),
            candidate.get("experience"), candidate.get("expected_salary"),
            raw.get("skills"), raw.get("summary"), raw.get("workExperience"), raw.get("projects"),
            raw.get("rawText"), raw.get("description"),
        ]
    ).lower()
    keywords = extract_requirement_keywords_backend(requirement)
    matched = [item for item in keywords if item in resume_text]
    missing = [item for item in keywords if item not in resume_text]
    ratio = 1.0 if not keywords else len(matched) / len(keywords)
    if ratio >= 0.68:
        verdict = "匹配"
        adjustment = 6
    elif ratio >= 0.38:
        verdict = "部分匹配"
        adjustment = 0
    else:
        verdict = "不匹配"
        adjustment = -8

    evaluation = raw.get("evaluation") if isinstance(raw.get("evaluation"), dict) else {}
    dimensions = evaluation.get("dimensions") if isinstance(evaluation.get("dimensions"), dict) else {}
    dimensions["jd"] = {
        "match": verdict,
        "ratio": round(ratio, 2),
        "matched": matched[:12],
        "missing": missing[:12],
        "source": "岗位要求库",
    }
    evaluation["dimensions"] = dimensions
    reasons = evaluation.get("rejectionReasons") if isinstance(evaluation.get("rejectionReasons"), list) else []
    if verdict == "不匹配" and missing:
        reasons = [f"岗位要求缺失：{', '.join(missing[:6])}", *reasons]
    evaluation["rejectionReasons"] = reasons[:12]
    raw["evaluation"] = evaluation
    raw["jobRequirement"] = requirement
    raw["jobRequirementRole"] = job.get("role") or candidate.get("role")

    base_score = int(candidate.get("score") or evaluation.get("score") or 0)
    next_score = max(0, min(100, base_score + adjustment))
    recommendation = str(candidate.get("recommendation") or evaluation.get("recommendation") or "待评估")
    if verdict == "不匹配" and next_score < 60:
        recommendation = "不推荐"
    elif verdict == "部分匹配" and recommendation == "推荐":
        recommendation = "待定"
    evaluation["score"] = next_score
    evaluation["recommendation"] = recommendation

    return {
        "raw_json": json.dumps(raw, ensure_ascii=False),
        "score": next_score,
        "recommendation": recommendation,
    }


def match_candidates_with_job_requirements(role: str = "") -> dict[str, Any]:
    updated = 0
    skipped = 0
    with connect() as conn:
        candidates = conn.execute(
            "SELECT * FROM candidates WHERE role = ? ORDER BY updated_at DESC" if role else "SELECT * FROM candidates ORDER BY updated_at DESC",
            (role,) if role else (),
        ).fetchall()
        for row in candidates:
            candidate = dict(row)
            job = get_job_requirement(candidate.get("role", ""))
            if not job:
                skipped += 1
                continue
            result = match_candidate_with_requirement(candidate, job)
            conn.execute(
                """
                UPDATE candidates
                SET raw_json = ?, score = ?, recommendation = ?, updated_at = ?
                WHERE id = ?
                """,
                (result["raw_json"], result["score"], result["recommendation"], now_iso(), candidate["id"]),
            )
            updated += 1
    return {"success": True, "updated": updated, "skipped": skipped}


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


def list_rows(
    table: str,
    limit: int = 200,
    date_field: str | None = None,
    date_value: str | None = None,
    filters: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    allowed = {"candidates", "recommendations", "reports", "job_requirements"}
    if table not in allowed:
        raise ValueError("invalid table")
    sql = f"SELECT * FROM {table}"
    params: list[Any] = []
    where: list[str] = []
    if date_field and date_value:
        where.append(f"{date_field} LIKE ?")
        params.append(f"{date_value}%")
    filters = filters or {}
    q = (filters.get("q") or "").strip()
    source = (filters.get("source") or "").strip()
    account = (filters.get("account") or "").strip()
    if q:
        searchable = {
            "candidates": ["name", "role", "education", "experience", "expected_salary", "recommendation", "raw_json"],
            "recommendations": ["name", "role", "recommendation", "next_step", "raw_json"],
            "reports": ["name", "role", "report"],
            "job_requirements": ["role", "requirement", "source", "account_name"],
        }[table]
        where.append("(" + " OR ".join(f"{field} LIKE ?" for field in searchable) + ")")
        params.extend([f"%{q}%"] * len(searchable))
    if source and table in {"candidates", "recommendations"}:
        where.append("source LIKE ?")
        params.append(f"%{source}%")
    if account and table in {"candidates", "recommendations"}:
        where.append("account_name LIKE ?")
        params.append(f"%{account}%")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def get_stats() -> dict[str, Any]:
    today = date_str()
    yesterday = date_str(-1)
    with connect() as conn:
        total_candidates = conn.execute("SELECT COUNT(*) AS count FROM candidates").fetchone()["count"]
        today_candidates = conn.execute(
            "SELECT COUNT(*) AS count FROM candidates WHERE received_date = ?",
            (today,),
        ).fetchone()["count"]
        yesterday_candidates = conn.execute(
            "SELECT COUNT(*) AS count FROM candidates WHERE received_date = ?",
            (yesterday,),
        ).fetchone()["count"]
        recommendation_count = conn.execute("SELECT COUNT(*) AS count FROM recommendations").fetchone()["count"]
        report_count = conn.execute("SELECT COUNT(*) AS count FROM reports").fetchone()["count"]
        avg_score = conn.execute("SELECT AVG(score) AS score FROM recommendations").fetchone()["score"] or 0
        by_source = [
            dict(row) for row in conn.execute(
                "SELECT COALESCE(NULLIF(source, ''), '未知来源') AS name, COUNT(*) AS count "
                "FROM candidates GROUP BY COALESCE(NULLIF(source, ''), '未知来源') ORDER BY count DESC"
            ).fetchall()
        ]
        by_account = [
            dict(row) for row in conn.execute(
                "SELECT COALESCE(NULLIF(account_name, ''), '未识别') AS name, COUNT(*) AS count "
                "FROM candidates GROUP BY COALESCE(NULLIF(account_name, ''), '未识别') ORDER BY count DESC"
            ).fetchall()
        ]
        top_recommendations = [
            dict(row) for row in conn.execute(
                "SELECT name, role, score, recommendation, next_step, source, account_name, created_at "
                "FROM recommendations ORDER BY score DESC, created_at DESC LIMIT 10"
            ).fetchall()
        ]
    return {
        "totalCandidates": total_candidates,
        "todayCandidates": today_candidates,
        "yesterdayCandidates": yesterday_candidates,
        "recommendationCount": recommendation_count,
        "reportCount": report_count,
        "averageScore": round(float(avg_score), 1),
        "bySource": by_source,
        "byAccount": by_account,
        "topRecommendations": top_recommendations,
    }


def rows_to_csv(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([title for _, title in columns])
    for row in rows:
        writer.writerow([row.get(key, "") for key, _ in columns])
    return output.getvalue()


def save_agent_conversation(
    question: str,
    answer: str,
    channel: str = "web",
    sender: str = "",
    raw: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item_id = uuid.uuid4().hex
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO agent_conversations
            (id, channel, sender, question, answer, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                channel,
                sender,
                question,
                answer,
                json.dumps(raw or {}, ensure_ascii=False),
                now_iso(),
            ),
        )
    return {"success": True, "id": item_id}


def list_agent_conversations(limit: int = 100) -> list[dict[str, Any]]:
    with connect() as conn:
        return [
            dict(row) for row in conn.execute(
                "SELECT * FROM agent_conversations ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        ]


def build_llm_history_context(question: str, max_items: int = 80) -> str:
    candidates = list_rows("candidates", limit=max_items)
    recommendations = list_rows("recommendations", limit=max_items)
    reports = list_rows("reports", limit=max(20, min(max_items, 80)))
    job_requirements = list_job_requirements(limit=200)
    stats = get_stats()
    parts = [
        "【统计概览】",
        json.dumps(stats, ensure_ascii=False),
        "",
        "【候选人历史】",
    ]
    for idx, item in enumerate(candidates, 1):
        parts.append(
            f"{idx}. 姓名:{item.get('name','')}｜岗位:{item.get('role','')}｜学历:{item.get('education','')}｜"
            f"经验:{item.get('experience','')}｜薪资:{item.get('expected_salary','')}｜匹配度:{item.get('score',0)}｜"
            f"推荐:{item.get('recommendation','')}｜来源:{item.get('source','')}｜账号:{item.get('account_name','')}｜日期:{item.get('received_date','')}"
        )
    parts.extend(["", "【推荐记录】"])
    for idx, item in enumerate(recommendations, 1):
        parts.append(
            f"{idx}. 姓名:{item.get('name','')}｜岗位:{item.get('role','')}｜匹配度:{item.get('score',0)}｜"
            f"推荐:{item.get('recommendation','')}｜下一步:{item.get('next_step','')}｜来源:{item.get('source','')}｜账号:{item.get('account_name','')}｜时间:{item.get('created_at','')}"
        )
    parts.extend(["", "【候选人报告摘要】"])
    for idx, item in enumerate(reports[:30], 1):
        report = str(item.get("report") or "").replace("\n", " ")
        parts.append(f"{idx}. {item.get('name','')}｜{item.get('role','')}｜{report[:900]}")
    parts.extend(["", "【岗位要求库】"])
    for idx, item in enumerate(job_requirements[:80], 1):
        requirement = str(item.get("requirement") or "").replace("\n", " ")
        parts.append(f"{idx}. 岗位:{item.get('role','')}｜来源:{item.get('source','')}｜账号:{item.get('account_name','')}｜要求:{requirement[:900]}")
    return "\n".join(parts)[:24000]


def build_llm_system_prompt() -> str:
    return (
        "你是招聘助手的问答 Agent。你只能根据提供的招聘历史数据回答问题。"
        "回答要使用中文，适合钉钉 markdown 展示。"
        "如果历史数据没有答案，要明确说没有找到，不要编造候选人。"
        "回答候选人时优先给出姓名、岗位、匹配度、推荐意见、来源、账号、下一步。"
    )


def request_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **headers,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def request_llm_json(url: str, payload: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    return request_json(url, payload, {"Authorization": f"Bearer {config['llmApiKey']}"})


def extract_anthropic_answer(body: dict[str, Any]) -> str:
    parts: list[str] = []
    for content in body.get("content", []) or []:
        if content.get("type") == "text" and content.get("text"):
            parts.append(str(content["text"]))
    return "\n".join(parts).strip()


def call_llm_chat_completions(question: str, context: str, config: dict[str, Any]) -> str:
    url = f"{str(config['llmApiBase']).rstrip('/')}/chat/completions"
    payload = {
        "model": config["llmModel"],
        "temperature": config["llmTemperature"],
        "max_tokens": int(config.get("llmMaxTokens") or 1000),
        "messages": [
            {"role": "system", "content": build_llm_system_prompt()},
            {"role": "user", "content": f"问题：{question}\n\n招聘历史数据：\n{context}"},
        ],
    }
    body = request_llm_json(url, payload, config)
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("大模型 API 未返回 choices")
    message = choices[0].get("message") or {}
    answer = str(message.get("content") or "").strip()
    if not answer:
        raise RuntimeError("大模型 API 返回空答案")
    return answer[:18000]


def call_llm_anthropic_messages(question: str, context: str, config: dict[str, Any]) -> str:
    url = f"{str(config['llmApiBase']).rstrip('/')}/messages"
    payload = {
        "model": config["llmModel"],
        "max_tokens": int(config.get("llmMaxTokens") or 1000),
        "system": build_llm_system_prompt(),
        "messages": [
            {
                "role": "user",
                "content": f"问题：{question}\n\n招聘历史数据：\n{context}",
            }
        ],
    }
    body = request_json(
        url,
        payload,
        {
            "x-api-key": str(config["llmApiKey"]),
            "anthropic-version": "2023-06-01",
        },
    )
    answer = extract_anthropic_answer(body)
    if not answer:
        raise RuntimeError("Claude Messages API 返回空答案")
    return answer[:18000]


def call_llm_chat(question: str, context: str) -> str:
    config = get_llm_config(mask_key=False)
    if not config.get("llmEnabled"):
        raise RuntimeError("大模型问答未启用")
    if not config.get("llmApiKey"):
        raise RuntimeError("大模型 API Key 未配置")
    if not config.get("llmApiBase"):
        raise RuntimeError("大模型 API Base URL 未配置")
    if not config.get("llmModel"):
        raise RuntimeError("大模型模型名未配置")

    try:
        if config.get("llmProtocol") == "anthropic-messages":
            return call_llm_anthropic_messages(question, context, config)
        return call_llm_chat_completions(question, context, config)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        if exc.code == 403:
            raise RuntimeError(
                "大模型 API 返回 403 Forbidden。请检查 API Key 是否有效、账户额度/模型权限是否开通、Base URL 是否正确。"
                f" 服务返回：{detail}"
            )
        raise RuntimeError(f"大模型 API HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"大模型 API 网络连接失败：{exc}")
    except Exception:
        raise


def answer_question_with_agent(question: str) -> tuple[str, dict[str, Any]]:
    fallback = answer_question_rules(question)
    config = get_llm_config(mask_key=False)
    if not config.get("llmEnabled"):
        return fallback, {"mode": "rules", "llmEnabled": False}
    try:
        context = build_llm_history_context(question, int(config.get("llmMaxContextItems") or 80))
        answer = call_llm_chat(question, context)
        return answer, {"mode": "llm", "model": config.get("llmModel"), "contextLength": len(context)}
    except Exception as exc:
        return (
            f"{fallback}\n\n---\n\n> 大模型回答暂不可用，已使用本地历史规则回答。原因：{exc}",
            {"mode": "rules-fallback", "error": str(exc), "model": config.get("llmModel")},
        )


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


def get_llm_config(mask_key: bool = False) -> dict[str, Any]:
    settings = get_settings()
    provider = str(settings.get("llmProvider") or DEFAULT_LLM_CONFIG["llmProvider"])
    preset = LLM_PROVIDER_PRESETS.get(provider, LLM_PROVIDER_PRESETS["custom"])
    config = {
        **DEFAULT_LLM_CONFIG,
        "llmEnabled": bool(settings.get("llmEnabled", DEFAULT_LLM_CONFIG["llmEnabled"])),
        "llmProvider": provider,
        "llmProtocol": str(settings.get("llmProtocol") or preset["protocol"]),
        "llmApiBase": str(settings.get("llmApiBase") or "").rstrip("/"),
        "llmApiKey": str(settings.get("llmApiKey") or ""),
        "llmModel": str(settings.get("llmModel") or ""),
        "llmTemperature": float(settings.get("llmTemperature", DEFAULT_LLM_CONFIG["llmTemperature"]) or 0.2),
        "llmMaxContextItems": int(settings.get("llmMaxContextItems", DEFAULT_LLM_CONFIG["llmMaxContextItems"]) or 80),
        "llmMaxTokens": int(settings.get("llmMaxTokens", DEFAULT_LLM_CONFIG["llmMaxTokens"]) or 1000),
    }
    if mask_key and config.get("llmApiKey"):
        config["llmApiKey"] = "********"
        config["llmApiKeyConfigured"] = True
    else:
        config["llmApiKeyConfigured"] = bool(config.get("llmApiKey"))
    return config


def save_llm_config(payload: dict[str, Any]) -> dict[str, Any]:
    current = get_llm_config(mask_key=False)
    provider = str(payload.get("llmProvider") or current["llmProvider"] or "openai")
    preset = LLM_PROVIDER_PRESETS.get(provider, LLM_PROVIDER_PRESETS["custom"])
    api_base = str(payload.get("llmApiBase") or "").rstrip("/")
    model = str(payload.get("llmModel") or "")
    config: dict[str, Any] = {
        "llmEnabled": bool(payload.get("llmEnabled", current["llmEnabled"])),
        "llmProvider": provider,
        "llmProtocol": preset["protocol"],
        "llmApiBase": api_base,
        "llmModel": model,
        "llmTemperature": max(0, min(float(payload.get("llmTemperature", current["llmTemperature"]) or 0.2), 2)),
        "llmMaxContextItems": max(10, min(int(payload.get("llmMaxContextItems", current["llmMaxContextItems"]) or 80), 500)),
        "llmMaxTokens": max(100, min(int(payload.get("llmMaxTokens", current["llmMaxTokens"]) or 1000), 8000)),
    }
    api_key = str(payload.get("llmApiKey") or "").strip()
    if api_key and api_key != "********":
        config["llmApiKey"] = api_key
    elif current.get("llmApiKey"):
        config["llmApiKey"] = current["llmApiKey"]
    else:
        config["llmApiKey"] = ""
    save_settings(config)
    return {"success": True, "llm": get_llm_config(mask_key=True)}


def reset_llm_config() -> dict[str, Any]:
    save_settings({
        "llmEnabled": DEFAULT_LLM_CONFIG["llmEnabled"],
        "llmProvider": DEFAULT_LLM_CONFIG["llmProvider"],
        "llmProtocol": DEFAULT_LLM_CONFIG["llmProtocol"],
        "llmApiBase": DEFAULT_LLM_CONFIG["llmApiBase"],
        "llmApiKey": "",
        "llmModel": DEFAULT_LLM_CONFIG["llmModel"],
        "llmTemperature": DEFAULT_LLM_CONFIG["llmTemperature"],
        "llmMaxContextItems": DEFAULT_LLM_CONFIG["llmMaxContextItems"],
        "llmMaxTokens": DEFAULT_LLM_CONFIG["llmMaxTokens"],
    })
    return {"success": True, "llm": get_llm_config(mask_key=True)}


def get_behavior_policy() -> dict[str, Any]:
    settings = get_settings()
    saved = settings.get("behaviorPolicy") if isinstance(settings.get("behaviorPolicy"), dict) else {}
    policy = {**DEFAULT_BEHAVIOR_POLICY, **saved}
    interaction_modes = {
        **DEFAULT_BEHAVIOR_POLICY["interactionModes"],
        **(saved.get("interactionModes", {}) if isinstance(saved.get("interactionModes"), dict) else {}),
    }
    policy["interactionModes"] = interaction_modes
    return policy


def save_behavior_policy(payload: dict[str, Any]) -> dict[str, Any]:
    current = get_behavior_policy()
    next_policy = {**current}
    numeric_fields = [
        "requestDelayMin", "requestDelayMax", "detailDwellMin", "detailDwellMax",
        "actionDwellMin", "actionDwellMax", "dailyLimit", "hourlyLimit",
        "maxCandidatesPerRun", "browseProbability", "longBreakEvery",
        "longBreakMin", "longBreakMax",
    ]
    for field in numeric_fields:
        if field in payload:
            value = float(payload[field]) if field == "browseProbability" else int(payload[field])
            next_policy[field] = max(0, value)
    if next_policy["requestDelayMax"] < next_policy["requestDelayMin"]:
        next_policy["requestDelayMax"] = next_policy["requestDelayMin"]
    if next_policy["detailDwellMax"] < next_policy["detailDwellMin"]:
        next_policy["detailDwellMax"] = next_policy["detailDwellMin"]
    if next_policy["actionDwellMax"] < next_policy["actionDwellMin"]:
        next_policy["actionDwellMax"] = next_policy["actionDwellMin"]

    next_policy["behaviorPolicyEnabled"] = bool(payload.get("behaviorPolicyEnabled", next_policy.get("behaviorPolicyEnabled")))
    if payload.get("scrollMode") in {"mixed", "fast", "slow", "segmented"}:
        next_policy["scrollMode"] = payload["scrollMode"]
    if isinstance(payload.get("interactionModes"), dict):
        next_policy["interactionModes"] = {
            "manualPage": int(payload["interactionModes"].get("manualPage", 40) or 0),
            "detailClick": int(payload["interactionModes"].get("detailClick", 35) or 0),
            "filterReview": int(payload["interactionModes"].get("filterReview", 25) or 0),
        }
    if isinstance(payload.get("searchKeywordPool"), list):
        next_policy["searchKeywordPool"] = [
            str(item).strip() for item in payload["searchKeywordPool"] if str(item).strip()
        ][:30]
    elif isinstance(payload.get("searchKeywordPool"), str):
        next_policy["searchKeywordPool"] = [
            item.strip() for item in payload["searchKeywordPool"].replace("，", "\n").splitlines() if item.strip()
        ][:30]
    next_policy["workTimeEnabled"] = bool(payload.get("workTimeEnabled", next_policy.get("workTimeEnabled")))
    for field in ("workStartTime", "workEndTime"):
        value = str(payload.get(field) or next_policy.get(field) or "").strip()
        if len(value) >= 5 and value[2] == ":":
            next_policy[field] = value[:5]
    if isinstance(payload.get("workDays"), list):
        next_policy["workDays"] = [
            day for day in [int(item) for item in payload["workDays"] if str(item).isdigit()]
            if 1 <= day <= 7
        ] or DEFAULT_BEHAVIOR_POLICY["workDays"]

    save_settings({"behaviorPolicy": next_policy})
    return {"success": True, "behaviorPolicy": next_policy}


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
        msg_param = payload.get("msgParam")
        if isinstance(msg_param, str):
            try:
                msg_payload = json.loads(msg_param)
                if isinstance(msg_payload, dict):
                    text = str(msg_payload.get("content") or msg_payload.get("text") or "")
            except json.JSONDecodeError:
                text = msg_param
        if not text:
            text = str(payload.get("content") or payload.get("message") or payload.get("query") or "")

    at_users = payload.get("atUsers") or []
    if isinstance(at_users, list):
        for user in at_users:
            if isinstance(user, dict):
                text = text.replace(str(user.get("dingtalkId") or ""), "")
                text = text.replace(str(user.get("staffId") or ""), "")

    return {
        "question": text.strip(),
        "sessionWebhook": payload.get("sessionWebhook") or "",
        "senderNick": payload.get("senderNick") or payload.get("senderStaffId") or payload.get("senderId") or "",
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


def dingtalk_markdown_reply(title: str, text: str) -> dict[str, Any]:
    return {
        "msgtype": "markdown",
        "markdown": {
            "title": title,
            "text": text,
        },
    }


def dingtalk_stream_ack_with_answer(answer: str) -> dict[str, Any]:
    ack = dingtalk_callback_ack()
    ack["data"] = json.dumps(dingtalk_markdown_reply("招聘助手问答", answer), ensure_ascii=False)
    return ack


def handle_dingtalk_conversation(payload: dict[str, Any]) -> dict[str, Any]:
    message = parse_dingtalk_message(payload)
    question = message["question"]
    if not question:
        answer = "### 招聘助手\n\n我没有收到有效问题。你可以问：昨天推荐了谁？React候选人有哪些？匹配度最高的是谁？"
        agent_meta = {"mode": "empty"}
    else:
        answer, agent_meta = answer_question_with_agent(question)

    save_agent_conversation(
        question=question or "(empty)",
        answer=answer,
        channel="dingtalk",
        sender=message.get("senderNick", ""),
        raw=message.get("raw", {}),
    )

    webhook = message.get("sessionWebhook")
    if webhook:
        push_result = send_dingtalk_markdown_to_webhook(
            webhook,
            "招聘助手问答",
            answer,
            "",
        )
    else:
        settings = get_settings()
        push_result = {"success": False, "skipped": True, "message": "使用钉钉回调直接回复"}
        if settings.get("dingtalkWebhook"):
            try:
                push_result = send_dingtalk_markdown("招聘助手问答", answer)
            except Exception as exc:
                push_result = {"success": False, "message": str(exc)}

    return {
        "success": True,
        "question": question,
        "answer": answer,
        "agent": agent_meta,
        "reply": push_result,
        "directReply": dingtalk_markdown_reply("招聘助手问答", answer),
        "ack": dingtalk_stream_ack_with_answer(answer),
    }


def build_summary(scope: str = "all") -> str:
    target_date = date_str(-1) if scope == "yesterday" else None
    candidates = list_rows("candidates", limit=1000, date_field="received_date", date_value=target_date)
    recommendations = list_rows("recommendations", limit=1000, date_field="created_at", date_value=target_date)
    title_date = target_date or "全部历史"
    recommended_candidates = [
        item for item in candidates
        if int(item.get("score") or 0) >= 60 or str(item.get("recommendation") or "") in {"推荐", "强烈推荐"}
    ]
    account_names = sorted({
        str(item.get("account_name") or "未识别") for item in [*candidates, *recommendations, *recommended_candidates]
    })

    def account_count(rows: list[dict[str, Any]], account: str) -> int:
        return sum(1 for item in rows if str(item.get("account_name") or "未识别") == account)

    def account_lines(rows: list[dict[str, Any]], empty: str = "暂无") -> list[str]:
        if not rows:
            return [empty]
        return [f"{account}丨{account_count(rows, account)}" for account in account_names if account_count(rows, account) > 0] or [empty]

    received_candidates = [item for item in candidates if item.get("raw_json")]
    source_counts: dict[str, int] = {}
    for item in candidates:
        source = item.get("source") or "未知来源"
        source_counts[source] = source_counts.get(source, 0) + 1
    source_text = "，".join(f"{k} {v}份" for k, v in source_counts.items()) or "暂无"

    detail_rows = [
        f"| {item.get('name','')} | {item.get('role','')} | {item.get('education','')} | {item.get('experience','')} | {item.get('score',0)}% | {item.get('source','')} | {item.get('account_name') or '未识别'} |"
        for item in recommended_candidates[:50]
    ]
    return "\n".join(
        [
            f"### {title_date} 招聘数据汇总",
            "",
            "#### 定时推送",
            f"昨日新增：{len(candidates)}",
            *account_lines(candidates),
            "",
            f"昨日收到简历数量：{len(received_candidates)}",
            *account_lines(received_candidates),
            "",
            f"昨日推荐候选人：{len(recommended_candidates)}",
            *account_lines(recommended_candidates),
            "",
            f"数据来源：{source_text}",
            "",
            "#### 建议继续推进候选人详情",
            "",
            "| 姓名 | 岗位 | 学历 | 经验 | 匹配度 | 来源 | 账号 |",
            "|------|------|------|------|--------|------|------|",
            *(detail_rows or ["| 暂无 | - | - | - | - | - | - |"]),
        ]
    )


def answer_question_rules(question: str) -> str:
    question = question.strip()
    if not question:
        return "请提出一个和招聘历史数据有关的问题。"
    today = date_str()
    yesterday = date_str(-1)
    scope_label = "全部历史"
    scope_date = None
    if "今天" in question or "今日" in question:
        scope_date = today
        scope_label = "今日"
    elif "昨天" in question or "昨日" in question:
        scope_date = yesterday
        scope_label = "昨日"
    candidates = list_rows("candidates", limit=1000, date_field="received_date", date_value=scope_date)
    recommendations = list_rows("recommendations", limit=1000, date_field="created_at", date_value=scope_date)
    if any(word in question for word in ["汇总", "统计", "多少", "数量"]):
        sources: dict[str, int] = {}
        accounts: dict[str, int] = {}
        for row in candidates:
            sources[row.get("source") or "未知来源"] = sources.get(row.get("source") or "未知来源", 0) + 1
            accounts[row.get("account_name") or "未识别"] = accounts.get(row.get("account_name") or "未识别", 0) + 1
        source_text = "，".join(f"{k} {v}份" for k, v in sources.items()) or "暂无"
        account_text = "，".join(f"{k} {v}份" for k, v in accounts.items()) or "暂无"
        return f"### 招聘助手答复\n\n- 查询范围：{scope_label}\n- 候选人数量：{len(candidates)}\n- 推荐候选人：{len(recommendations)}\n- 数据来源：{source_text}\n- 账号分布：{account_text}"
    cleaned = question
    highest_query = any(word in question for word in ["最高", "最好", "最合适", "排名"])
    for word in ["今天", "今日", "昨天", "昨日", "候选人", "推荐", "简历", "哪些", "哪个", "有没有", "最高", "最好", "最合适", "匹配度", "统计", "汇总", "来源", "账号", "的是谁", "是谁", "的", "谁"]:
        cleaned = cleaned.replace(word, " ")
    keywords = [word for word in cleaned.replace("？", " ").replace("?", " ").split() if len(word) >= 2]
    rows = recommendations or candidates
    if keywords and not highest_query:
        rows = [
            row for row in rows
            if any(keyword.lower() in json.dumps(dict(row), ensure_ascii=False).lower() for keyword in keywords)
        ]
    rows = sorted(rows, key=lambda row: row.get("score") or 0, reverse=True)
    if not rows:
        return f"### 招聘助手答复\n\n没有找到和“{question}”匹配的历史候选人。"
    lines = [
        f"{idx + 1}. {row.get('name','未识别')}｜{row.get('role','待确认')}｜{row.get('score',0)}%｜{row.get('recommendation','待评估')}｜{row.get('source','未知来源')}｜{row.get('account_name','未识别')}"
        for idx, row in enumerate(rows[:10])
    ]
    role_requirements = []
    seen_roles = set()
    for row in rows[:5]:
        role = row.get("role") or ""
        normalized = normalize_role(role)
        if not normalized or normalized in seen_roles:
            continue
        seen_roles.add(normalized)
        requirement = get_job_requirement(role)
        if requirement:
            role_requirements.append(f"- {role}：{str(requirement.get('requirement') or '')[:180]}")
    requirement_text = "\n\n岗位要求依据：\n" + "\n".join(role_requirements) if role_requirements else ""
    return f"### 招聘助手答复\n\n查询范围：{scope_label}\n\n" + "\n".join(lines) + requirement_text


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
            elif parsed.path == "/api/stats":
                json_response(self, get_stats())
            elif parsed.path == "/api/settings":
                settings = get_settings()
                llm_config = get_llm_config(mask_key=True)
                settings.update(llm_config)
                json_response(self, settings)
            elif parsed.path == "/api/llm/config":
                json_response(self, get_llm_config(mask_key=True))
            elif parsed.path == "/api/behavior-policy":
                json_response(self, get_behavior_policy())
            elif parsed.path == "/api/candidates":
                json_response(self, {"items": list_rows("candidates", int(query.get("limit", ["200"])[0]), filters={
                    "q": query.get("q", [""])[0],
                    "source": query.get("source", [""])[0],
                    "account": query.get("account", [""])[0],
                })})
            elif parsed.path == "/api/recommendations":
                json_response(self, {"items": list_rows("recommendations", int(query.get("limit", ["200"])[0]), filters={
                    "q": query.get("q", [""])[0],
                    "source": query.get("source", [""])[0],
                    "account": query.get("account", [""])[0],
                })})
            elif parsed.path == "/api/reports":
                json_response(self, {"items": list_rows("reports", int(query.get("limit", ["100"])[0]), filters={
                    "q": query.get("q", [""])[0],
                })})
            elif parsed.path == "/api/job-requirements":
                role = query.get("role", [""])[0]
                if role:
                    json_response(self, {"item": get_job_requirement(role)})
                else:
                    json_response(self, {"items": list_rows("job_requirements", int(query.get("limit", ["200"])[0]), filters={
                        "q": query.get("q", [""])[0],
                    })})
            elif parsed.path == "/api/agent/conversations":
                json_response(self, {"items": list_agent_conversations(int(query.get("limit", ["100"])[0]))})
            elif parsed.path == "/api/summary":
                scope = query.get("scope", ["all"])[0]
                json_response(self, {"markdown": build_summary(scope)})
            elif parsed.path == "/api/export/candidates.csv":
                rows = list_rows("candidates", 10000, filters={
                    "q": query.get("q", [""])[0],
                    "source": query.get("source", [""])[0],
                    "account": query.get("account", [""])[0],
                })
                text_response(self, rows_to_csv(rows, [
                    ("received_date", "日期"),
                    ("name", "姓名"),
                    ("role", "岗位"),
                    ("education", "学历"),
                    ("experience", "经验"),
                    ("expected_salary", "薪资"),
                    ("score", "匹配度"),
                    ("recommendation", "推荐意见"),
                    ("source", "数据来源"),
                    ("account_name", "账号信息"),
                    ("created_at", "创建时间"),
                ]), content_type="text/csv; charset=utf-8", filename="candidates.csv")
            elif parsed.path == "/api/export/recommendations.csv":
                rows = list_rows("recommendations", 10000, filters={
                    "q": query.get("q", [""])[0],
                    "source": query.get("source", [""])[0],
                    "account": query.get("account", [""])[0],
                })
                text_response(self, rows_to_csv(rows, [
                    ("created_at", "推荐时间"),
                    ("name", "姓名"),
                    ("role", "岗位"),
                    ("score", "匹配度"),
                    ("recommendation", "推荐意见"),
                    ("next_step", "下一步"),
                    ("source", "数据来源"),
                    ("account_name", "账号信息"),
                ]), content_type="text/csv; charset=utf-8", filename="recommendations.csv")
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
            elif parsed.path == "/api/llm/config":
                json_response(self, save_llm_config(payload))
            elif parsed.path == "/api/llm/config/reset":
                json_response(self, reset_llm_config())
            elif parsed.path == "/api/behavior-policy":
                json_response(self, save_behavior_policy(payload))
            elif parsed.path == "/api/candidates":
                json_response(self, upsert_candidate(payload))
            elif parsed.path == "/api/recommendations":
                json_response(self, save_recommendation(payload.get("candidate", payload), payload.get("report", "")))
            elif parsed.path == "/api/job-requirements":
                json_response(self, upsert_job_requirement(payload))
            elif parsed.path == "/api/job-requirements/match-candidates":
                json_response(self, match_candidates_with_job_requirements(str(payload.get("role", ""))))
            elif parsed.path == "/api/agent/ask":
                answer, agent_meta = answer_question_with_agent(str(payload.get("question", "")))
                save_agent_conversation(
                    question=str(payload.get("question", "")),
                    answer=answer,
                    channel="web",
                    sender=str(payload.get("sender", "Web 管理后台")),
                    raw=payload,
                )
                if payload.get("replyToDingTalk"):
                    send_dingtalk_markdown("招聘助手问答", answer)
                json_response(self, {"success": True, "answer": answer, "agent": agent_meta})
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
                    json_response(self, result["directReply"])
            elif parsed.path == "/api/dingtalk/callback-test":
                question = str(payload.get("question") or "")
                answer, agent_meta = answer_question_with_agent(question)
                save_agent_conversation(question=question, answer=answer, channel="test", sender="callback-test", raw=payload)
                json_response(self, {"success": True, "question": question, "answer": answer, "agent": agent_meta})
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
