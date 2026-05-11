#!/usr/bin/env python3
"""
招聘助手 - Recruitment Bot
============================
功能：招聘管道管理、候选人跟踪、面试安排、数据分析与报告生成

优化内容：
1. 从原始5行代码重构为完整的招聘管理系统
2. 集成 YAML 配置加载
3. 实现候选人全生命周期管理（添加、筛选、面试、录用）
4. 添加命令行交互界面（CLI）
5. 添加 JSON 数据持久化
6. 添加日志记录系统
7. 添加统计分析和报告生成
8. 完善错误处理和输入验证
"""

import json
import os
import sys
import time
import logging
import argparse
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# 尝试导入 YAML 解析库
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

# ============================================================
# 常量定义
# ============================================================

APP_NAME = "招聘助手"
APP_VERSION = "2.1.0"
DEFAULT_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hiring_config.yaml")
DEFAULT_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recruitment_data.json")

# 招聘管道阶段（按顺序）
PIPELINE_STAGES = [
    "sourcing",       # 人才寻源
    "screening",      # 简历筛选
    "phone_screen",   # 电话初筛
    "interview",      # 面试
    "offer",          # 发放Offer
    "onboarding",     # 入职
    "closed",         # 已关闭
]

# 面试类型
INTERVIEW_TYPES = ["technical", "behavioral", "system_design", "culture_fit"]

# 候选人状态
CANDIDATE_STATUSES = ["active", "on_hold", "rejected", "hired", "withdrawn"]

# 评分等级
SCORE_LEVELS = {
    1: "远低于标准 - 明确不录用",
    2: "低于标准 - 存在重大疑虑",
    3: "达到标准 - 可以录用",
    4: "优秀 - 明显高于标准",
    5: "卓越 - 前5%的候选人",
}

CORE_CAPABILITIES = [
    "候选人全生命周期管理：添加、筛选、推进、录用建议与状态追踪",
    "结构化面试评分：按技术能力、问题解决、沟通、协作、成长心态五个维度加权评估",
    "证据化决策：评分必须记录依据，降低光环效应、确认偏误和紧急招人带来的误判",
    "招聘漏斗分析：按阶段、岗位、渠道统计，并计算阶段转化率",
    "招聘风险预警：识别候选人停滞、关键维度低分、周期过长等问题",
    "候选人体验管理：关注响应速度、面试推进和 Offer 节奏",
    "浏览器插件同步：从 BOSS 直聘抓取/导出简历并导入本地招聘数据",
    "报告输出：生成 Markdown 招聘报告，沉淀管道概览、候选人详情和建议动作",
]

# ============================================================
# 日志配置
# ============================================================

def setup_logging(log_dir: str = None, level: str = "INFO") -> logging.Logger:
    """配置日志系统"""
    logger = logging.getLogger("recruitment_bot")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.handlers.clear()
    logger.propagate = False

    # 控制台输出
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_format = logging.Formatter(
        "[%(asctime)s] %(levelname)-8s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)

    # 文件输出
    if log_dir:
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        log_file = log_path / f"recruitment_{datetime.now().strftime('%Y%m%d')}.log"
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        file_format = logging.Formatter(
            "[%(asctime)s] %(levelname)-8s [%(funcName)s:%(lineno)d] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        file_handler.setFormatter(file_format)
        logger.addHandler(file_handler)

    return logger


logger = setup_logging()

# ============================================================
# 配置管理
# ============================================================

class ConfigManager:
    """配置文件管理器"""

    DEFAULT_CONFIG = {
        "process": PIPELINE_STAGES,
        "interview_types": INTERVIEW_TYPES,
        "scoring": {
            "weights": {
                "technical_skills": 0.30,
                "problem_solving": 0.25,
                "communication": 0.15,
                "collaboration": 0.15,
                "growth_mindset": 0.15,
            },
            "pass_threshold": 3.0,
            "strong_hire_threshold": 4.0,
        },
        "targets": {
            "time_to_hire_days": 45,
            "offer_acceptance_rate": 0.80,
            "retention_90_days": 0.95,
        },
        "notifications": {
            "stale_candidate_days": 7,
            "offer_expiry_days": 5,
        },
    }

    def __init__(self, config_path: str = None):
        self.config_path = config_path or DEFAULT_CONFIG_PATH
        self.config = self._load_config()

    def _load_config(self) -> dict:
        """加载配置文件，如不存在则使用默认配置"""
        if os.path.exists(self.config_path):
            try:
                if HAS_YAML:
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        config = yaml.safe_load(f) or {}
                else:
                    # 回退：尝试解析简单YAML
                    config = self._parse_simple_yaml(self.config_path)
                logger.info(f"配置文件加载成功: {self.config_path}")
                return deep_merge(self.DEFAULT_CONFIG, config)
            except Exception as e:
                logger.warning(f"配置文件加载失败，使用默认配置: {e}")
        else:
            logger.info("未找到配置文件，使用默认配置")
        return deepcopy(self.DEFAULT_CONFIG)

    def _parse_simple_yaml(self, path: str) -> dict:
        """简单的YAML解析回退方案"""
        config = {}
        current_key = None
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.endswith(":") and not line.startswith("-"):
                    key = line.rstrip(":").strip()
                    current_key = key
                    config[key] = []
                elif line.startswith("- ") and current_key:
                    config[current_key].append(line[2:].strip())
        return config

    def get(self, key: str, default=None):
        """获取配置项（支持点号分隔的嵌套键）"""
        keys = key.split(".")
        value = self.config
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        return value

    def save_default_config(self, path: str = None):
        """保存默认配置到文件"""
        save_path = path or self.config_path
        try:
            with open(save_path, "w", encoding="utf-8") as f:
                if HAS_YAML:
                    yaml.dump(self.DEFAULT_CONFIG, f, allow_unicode=True, default_flow_style=False)
                else:
                    f.write("# 招聘助手配置文件\n")
                    f.write("# Auto-generated by recruitment_bot\n\n")
                    for key, value in self.DEFAULT_CONFIG.items():
                        f.write(f"{key}:\n")
                        if isinstance(value, list):
                            for item in value:
                                f.write(f"  - {item}\n")
                        elif isinstance(value, dict):
                            for k, v in value.items():
                                f.write(f"  {k}: {v}\n")
                        f.write("\n")
            logger.info(f"默认配置已保存到: {save_path}")
            return True
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            return False


def deep_merge(base: dict, override: dict) -> dict:
    """递归合并配置，避免覆盖 scoring.weights 等嵌套默认项。"""
    merged = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


# ============================================================
# 数据模型
# ============================================================

class Candidate:
    """候选人数据模型"""

    _id_counter = 0

    def __init__(
        self,
        name: str,
        role: str,
        source: str = "",
        resume_url: str = "",
        email: str = "",
        phone: str = "",
        **kwargs,
    ):
        Candidate._id_counter += 1
        self.id = Candidate._id_counter
        self.name = name
        self.role = role
        self.source = source
        self.resume_url = resume_url
        self.email = email
        self.phone = phone
        self.stage = PIPELINE_STAGES[0]  # sourcing
        self.status = "active"
        self.scores = {}
        self.interviews = []
        self.notes = []
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()
        self.extra = kwargs

    def to_dict(self) -> dict:
        """序列化为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "source": self.source,
            "resume_url": self.resume_url,
            "email": self.email,
            "phone": self.phone,
            "stage": self.stage,
            "status": self.status,
            "scores": self.scores,
            "interviews": self.interviews,
            "notes": self.notes,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "extra": self.extra,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Candidate":
        """从字典反序列化"""
        candidate = cls(
            name=data["name"],
            role=data["role"],
            source=data.get("source", ""),
            resume_url=data.get("resume_url", ""),
            email=data.get("email", ""),
            phone=data.get("phone", ""),
        )
        candidate.id = data.get("id", candidate.id)
        candidate.stage = data.get("stage", PIPELINE_STAGES[0])
        candidate.status = data.get("status", "active")
        candidate.scores = data.get("scores", {})
        candidate.interviews = data.get("interviews", [])
        candidate.notes = data.get("notes", [])
        candidate.created_at = data.get("created_at", candidate.created_at)
        candidate.updated_at = data.get("updated_at", candidate.updated_at)
        candidate.extra = data.get("extra", {})
        if candidate.id >= cls._id_counter:
            cls._id_counter = candidate.id
        return candidate

    def advance_stage(self) -> bool:
        """推进到下一阶段"""
        try:
            current_idx = PIPELINE_STAGES.index(self.stage)
            if current_idx < len(PIPELINE_STAGES) - 1:
                self.stage = PIPELINE_STAGES[current_idx + 1]
                self.updated_at = datetime.now().isoformat()
                logger.info(f"候选人 {self.name} 已推进到阶段: {self.stage}")
                return True
            return False
        except ValueError:
            logger.warning(f"无效的阶段: {self.stage}")
            return False

    def add_score(self, category: str, score: int, evidence: str = "", interviewer: str = ""):
        """添加面试评分"""
        if not 1 <= score <= 5:
            raise ValueError(f"评分必须在1-5之间，当前值: {score}")
        self.scores[category] = {
            "score": score,
            "evidence": evidence,
            "interviewer": interviewer,
            "timestamp": datetime.now().isoformat(),
        }
        self.updated_at = datetime.now().isoformat()

    def get_weighted_score(self, weights: dict) -> float:
        """计算加权总分"""
        if not self.scores:
            return 0.0
        total_weight = 0.0
        weighted_sum = 0.0
        for category, weight in weights.items():
            if category in self.scores:
                weighted_sum += self.scores[category]["score"] * weight
                total_weight += weight
        return round(weighted_sum / total_weight, 2) if total_weight > 0 else 0.0

    def add_interview(self, interview_type: str, interviewer: str, date: str, notes: str = ""):
        """添加面试记录"""
        self.interviews.append({
            "type": interview_type,
            "interviewer": interviewer,
            "date": date,
            "notes": notes,
            "timestamp": datetime.now().isoformat(),
        })
        self.updated_at = datetime.now().isoformat()

    def add_note(self, note: str):
        """添加备注"""
        self.notes.append({
            "content": note,
            "timestamp": datetime.now().isoformat(),
        })
        self.updated_at = datetime.now().isoformat()

    def __repr__(self):
        return f"Candidate(id={self.id}, name='{self.name}', role='{self.role}', stage='{self.stage}')"


# ============================================================
# 数据持久化
# ============================================================

class DataStore:
    """JSON 数据持久化管理"""

    def __init__(self, data_path: str = None):
        self.data_path = data_path or DEFAULT_DATA_PATH
        self.candidates: list[Candidate] = []
        self.metadata = {
            "version": APP_VERSION,
            "created_at": datetime.now().isoformat(),
            "last_modified": datetime.now().isoformat(),
        }
        self._load()

    def _load(self):
        """从文件加载数据"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.metadata = data.get("metadata", self.metadata)
                self.candidates = [
                    Candidate.from_dict(c) for c in data.get("candidates", [])
                ]
                logger.info(f"数据加载成功: {len(self.candidates)} 位候选人")
            except (json.JSONDecodeError, KeyError) as e:
                logger.error(f"数据文件损坏，将创建新文件: {e}")
                self.candidates = []
        else:
            logger.info("数据文件不存在，将创建新文件")

    def save(self):
        """保存数据到文件"""
        self.metadata["last_modified"] = datetime.now().isoformat()
        try:
            with open(self.data_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "metadata": self.metadata,
                        "candidates": [c.to_dict() for c in self.candidates],
                    },
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
            logger.debug(f"数据已保存: {self.data_path}")
        except Exception as e:
            logger.error(f"数据保存失败: {e}")

    def add_candidate(self, candidate: Candidate) -> bool:
        """添加候选人"""
        for existing in self.candidates:
            same_person_role = existing.name == candidate.name and existing.role == candidate.role
            same_email = candidate.email and existing.email == candidate.email
            same_phone = candidate.phone and existing.phone == candidate.phone
            same_plugin_id = (
                candidate.extra.get("plugin_id")
                and existing.extra.get("plugin_id") == candidate.extra.get("plugin_id")
            )
            if same_person_role or same_email or same_phone or same_plugin_id:
                logger.warning(f"候选人已存在: {candidate.name} - {candidate.role}")
                return False
        self.candidates.append(candidate)
        self.save()
        logger.info(f"候选人已添加: {candidate.name} ({candidate.role})")
        return True

    def get_candidate(self, candidate_id: int) -> Optional[Candidate]:
        """根据ID获取候选人"""
        for c in self.candidates:
            if c.id == candidate_id:
                return c
        return None

    def get_candidates_by_stage(self, stage: str) -> list[Candidate]:
        """按阶段获取候选人"""
        return [c for c in self.candidates if c.stage == stage and c.status == "active"]

    def get_candidates_by_role(self, role: str) -> list[Candidate]:
        """按岗位获取候选人"""
        return [c for c in self.candidates if c.role == role and c.status == "active"]

    def get_active_candidates(self) -> list[Candidate]:
        """获取所有活跃候选人"""
        return [c for c in self.candidates if c.status == "active"]

    def get_statistics(self) -> dict:
        """获取招聘统计数据"""
        total = len(self.candidates)
        active = len(self.get_active_candidates())
        hired = len([c for c in self.candidates if c.status == "hired"])
        rejected = len([c for c in self.candidates if c.status == "rejected"])

        stage_counts = {}
        for stage in PIPELINE_STAGES:
            stage_counts[stage] = len(self.get_candidates_by_stage(stage))

        # 各岗位统计
        role_counts = {}
        for c in self.candidates:
            role_counts[c.role] = role_counts.get(c.role, 0) + 1

        # 来源统计
        source_counts = {}
        for c in self.candidates:
            if c.source:
                source_counts[c.source] = source_counts.get(c.source, 0) + 1

        stage_order = {stage: index for index, stage in enumerate(PIPELINE_STAGES)}
        reached_stage_counts = {}
        for stage, index in stage_order.items():
            reached_stage_counts[stage] = len([
                c for c in self.candidates
                if stage_order.get(c.stage, -1) >= index
            ])
        funnel_conversion = {}
        for idx in range(1, len(PIPELINE_STAGES)):
            previous_stage = PIPELINE_STAGES[idx - 1]
            current_stage = PIPELINE_STAGES[idx]
            previous_count = reached_stage_counts[previous_stage]
            current_count = reached_stage_counts[current_stage]
            funnel_conversion[f"{previous_stage}_to_{current_stage}"] = (
                round(current_count / previous_count * 100, 1) if previous_count else 0
            )

        return {
            "total_candidates": total,
            "active_candidates": active,
            "hired": hired,
            "rejected": rejected,
            "hired_rate": round(hired / total * 100, 1) if total > 0 else 0,
            "stage_distribution": stage_counts,
            "role_distribution": role_counts,
            "source_distribution": source_counts,
            "funnel_conversion": funnel_conversion,
        }


# ============================================================
# 招聘管道引擎
# ============================================================

class RecruitmentEngine:
    """招聘管道核心引擎"""

    def __init__(self, config: ConfigManager, data_store: DataStore):
        self.config = config
        self.data = data_store

    def add_candidate(self, name: str, role: str, **kwargs) -> Optional[Candidate]:
        """添加新候选人"""
        if not name.strip() or not role.strip():
            logger.error("候选人姓名和岗位不能为空")
            return None

        candidate = Candidate(name=name.strip(), role=role.strip(), **kwargs)
        if self.data.add_candidate(candidate):
            return candidate
        return None

    def advance_candidate(self, candidate_id: int) -> bool:
        """推进候选人到下一阶段"""
        candidate = self.data.get_candidate(candidate_id)
        if not candidate:
            logger.error(f"未找到候选人 ID: {candidate_id}")
            return False
        if candidate.status != "active":
            logger.warning(f"候选人 {candidate.name} 状态非活跃，无法推进")
            return False
        advanced = candidate.advance_stage()
        if advanced:
            self.data.save()
        return advanced

    def score_candidate(
        self, candidate_id: int, category: str, score: int, **kwargs
    ) -> bool:
        """为候选人评分"""
        candidate = self.data.get_candidate(candidate_id)
        if not candidate:
            logger.error(f"未找到候选人 ID: {candidate_id}")
            return False
        valid_categories = self.config.get("scoring.weights", {})
        if category not in valid_categories:
            logger.error(f"未知评分维度: {category}，可用维度: {', '.join(valid_categories)}")
            return False
        evidence = (kwargs.get("evidence") or "").strip()
        if not evidence:
            logger.error("评分必须填写具体依据，避免无证据决策")
            return False
        try:
            kwargs["evidence"] = evidence
            candidate.add_score(category, score, **kwargs)
            self.data.save()
            return True
        except ValueError as e:
            logger.error(f"评分失败: {e}")
            return False

    def get_recommendation(self, candidate_id: int) -> Optional[str]:
        """获取录用建议"""
        candidate = self.data.get_candidate(candidate_id)
        if not candidate:
            return None

        weights = self.config.get("scoring.weights", {})
        threshold = self.config.get("scoring.pass_threshold", 3.0)
        strong_threshold = self.config.get("scoring.strong_hire_threshold", 4.0)

        weighted_score = candidate.get_weighted_score(weights)
        if weighted_score == 0:
            return "待评估 (暂无结构化评分)"

        # 检查是否有任何维度低于3分
        critical_concerns = [
            cat for cat, data in candidate.scores.items() if data["score"] < 3
        ]

        if critical_concerns:
            return f"不录用 (加权分: {weighted_score}, 存在低分维度: {', '.join(critical_concerns)})"
        elif weighted_score >= strong_threshold:
            return f"强烈推荐录用 (加权分: {weighted_score})"
        elif weighted_score >= threshold:
            return f"建议录用 (加权分: {weighted_score})"
        else:
            return f"不推荐 (加权分: {weighted_score}，低于阈值 {threshold})"

    def get_candidate_alerts(self, candidate: Candidate) -> list[str]:
        """基于招聘规则生成候选人预警。"""
        alerts = []
        stale_days = self.config.get("notifications.stale_candidate_days", 7)
        try:
            updated_at = datetime.fromisoformat(candidate.updated_at)
            idle_days = (datetime.now() - updated_at).days
            if candidate.status == "active" and idle_days >= stale_days:
                alerts.append(f"停滞 {idle_days} 天，建议主动跟进候选人")
        except ValueError:
            alerts.append("更新时间格式异常，建议检查数据")

        low_scores = [
            category for category, item in candidate.scores.items()
            if item.get("score", 0) < 3
        ]
        if low_scores:
            alerts.append(f"关键维度低分: {', '.join(low_scores)}，需在复盘中讨论")

        missing_evidence = [
            category for category, item in candidate.scores.items()
            if not item.get("evidence")
        ]
        if missing_evidence:
            alerts.append(f"评分缺少依据: {', '.join(missing_evidence)}")

        return alerts

    def get_system_capabilities(self) -> list[str]:
        """返回招聘助手核心能力清单。"""
        return CORE_CAPABILITIES.copy()

    def generate_report(self, output_path: str = None) -> str:
        """生成招聘报告"""
        stats = self.data.get_statistics()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        report_lines = [
            f"# {APP_NAME} 招聘报告",
            f"",
            f"**生成时间**: {now}",
            f"**系统版本**: {APP_VERSION}",
            f"",
            f"---",
            f"",
            f"## 📊 总体概览",
            f"",
            f"| 指标 | 数值 |",
            f"|------|------|",
            f"| 候选人总数 | {stats['total_candidates']} |",
            f"| 活跃候选人 | {stats['active_candidates']} |",
            f"| 已录用 | {stats['hired']} |",
            f"| 已拒绝 | {stats['rejected']} |",
            f"| 录用率 | {stats['hired_rate']}% |",
            f"",
            f"## 🔄 管道阶段分布",
            f"",
            f"| 阶段 | 人数 |",
            f"|------|------|",
        ]

        stage_names = {
            "sourcing": "人才寻源",
            "screening": "简历筛选",
            "phone_screen": "电话初筛",
            "interview": "面试",
            "offer": "发放Offer",
            "onboarding": "入职",
            "closed": "已关闭",
        }

        for stage, count in stats["stage_distribution"].items():
            name = stage_names.get(stage, stage)
            report_lines.append(f"| {name} | {count} |")

        if stats["role_distribution"]:
            report_lines.extend([
                "",
                "## 💼 岗位分布",
                "",
                "| 岗位 | 候选人数 |",
                "|------|----------|",
            ])
            for role, count in sorted(stats["role_distribution"].items(), key=lambda x: -x[1]):
                report_lines.append(f"| {role} | {count} |")

        if stats["source_distribution"]:
            report_lines.extend([
                "",
                "## 📡 来源渠道分布",
                "",
                "| 渠道 | 人数 |",
                "|------|------|",
            ])
            for source, count in sorted(stats["source_distribution"].items(), key=lambda x: -x[1]):
                report_lines.append(f"| {source} | {count} |")

        if stats["funnel_conversion"]:
            report_lines.extend([
                "",
                "## 📈 阶段转化率",
                "",
                "| 转化节点 | 转化率 |",
                "|----------|--------|",
            ])
            for transition, rate in stats["funnel_conversion"].items():
                start, end = transition.split("_to_")
                start_name = stage_names.get(start, start)
                end_name = stage_names.get(end, end)
                report_lines.append(f"| {start_name} → {end_name} | {rate}% |")

        # 候选人详情
        active = self.data.get_active_candidates()
        if active:
            report_lines.extend([
                "",
                "## 👥 活跃候选人详情",
                "",
            ])
            for c in active:
                weights = self.config.get("scoring.weights", {})
                ws = c.get_weighted_score(weights)
                rec = self.get_recommendation(c.id) or "待评估"
                report_lines.extend([
                    f"### {c.name} - {c.role}",
                    f"- **当前阶段**: {stage_names.get(c.stage, c.stage)}",
                    f"- **来源**: {c.source or '未填写'}",
                    f"- **联系方式**: {c.email or c.phone or '未填写'}",
                f"- **加权评分**: {ws}",
                f"- **录用建议**: {rec}",
                f"- **创建时间**: {c.created_at}",
                "",
            ])
                alerts = self.get_candidate_alerts(c)
                if alerts:
                    report_lines.append("- **预警/下一步**:")
                    for alert in alerts:
                        report_lines.append(f"  - {alert}")
                    report_lines.append("")

        report_content = "\n".join(report_lines)

        # 保存报告
        if output_path:
            try:
                with open(output_path, "w", encoding="utf-8") as f:
                    f.write(report_content)
                logger.info(f"报告已保存到: {output_path}")
            except Exception as e:
                logger.error(f"报告保存失败: {e}")

        return report_content


# ============================================================
# 命令行界面
# ============================================================

class RecruitmentCLI:
    """命令行交互界面"""

    STAGE_NAMES = {
        "sourcing": "人才寻源",
        "screening": "简历筛选",
        "phone_screen": "电话初筛",
        "interview": "面试",
        "offer": "发放Offer",
        "onboarding": "入职",
        "closed": "已关闭",
    }

    def __init__(self, engine: RecruitmentEngine):
        self.engine = engine

    def print_banner(self):
        """打印欢迎横幅"""
        banner = f"""
╔══════════════════════════════════════════╗
║          {APP_NAME} v{APP_VERSION}           ║
║      智能招聘管道管理系统                ║
╚══════════════════════════════════════════╝
        """
        print(banner)

    def print_menu(self):
        """打印主菜单"""
        menu = """
📋 主菜单:
  1. 添加候选人
  2. 查看所有候选人
  3. 查看管道概览
  4. 推进候选人阶段
  5. 为候选人评分
  6. 查看录用建议
  7. 生成招聘报告
  8. 查看统计数据
  9. 查看核心能力
  c. 保存默认配置
  0. 退出
        """
        print(menu)

    def run(self):
        """运行交互式CLI"""
        self.print_banner()

        while True:
            self.print_menu()
            choice = input("请选择操作 (0-9/c): ").strip().lower()

            actions = {
                "1": self._action_add_candidate,
                "2": self._action_list_candidates,
                "3": self._action_pipeline_overview,
                "4": self._action_advance_candidate,
                "5": self._action_score_candidate,
                "6": self._action_recommendation,
                "7": self._action_generate_report,
                "8": self._action_statistics,
                "9": self._action_capabilities,
                "c": self._action_save_config,
                "0": self._action_exit,
            }

            action = actions.get(choice)
            if action:
                action()
            else:
                print("❌ 无效选择，请重新输入")

    def _action_add_candidate(self):
        """添加候选人"""
        print("\n--- 添加候选人 ---")
        name = input("姓名: ").strip()
        role = input("岗位: ").strip()
        source = input("来源渠道 (可选): ").strip()
        email = input("邮箱 (可选): ").strip()
        phone = input("电话 (可选): ").strip()

        candidate = self.engine.add_candidate(
            name=name, role=role, source=source, email=email, phone=phone
        )
        if candidate:
            print(f"✅ 候选人已添加: {candidate.name} (ID: {candidate.id})")
        else:
            print("❌ 添加失败，请检查输入")

    def _action_list_candidates(self):
        """列出所有候选人"""
        candidates = self.engine.data.get_active_candidates()
        if not candidates:
            print("\n📭 暂无活跃候选人")
            return

        print(f"\n--- 活跃候选人 (共 {len(candidates)} 人) ---")
        print(f"{'ID':<5} {'姓名':<15} {'岗位':<20} {'阶段':<12} {'来源':<10}")
        print("-" * 65)
        for c in candidates:
            stage_name = self.STAGE_NAMES.get(c.stage, c.stage)
            print(f"{c.id:<5} {c.name:<15} {c.role:<20} {stage_name:<12} {c.source or '-':<10}")

    def _action_pipeline_overview(self):
        """管道概览"""
        print("\n--- 招聘管道概览 ---")
        for i, stage in enumerate(PIPELINE_STAGES):
            count = len(self.engine.data.get_candidates_by_stage(stage))
            name = self.STAGE_NAMES.get(stage, stage)
            arrow = " → " if i < len(PIPELINE_STAGES) - 1 else ""
            print(f"  [{count:>3}人] {name}{arrow}")
        print()

    def _action_advance_candidate(self):
        """推进候选人阶段"""
        candidate_id = input("\n请输入候选人ID: ").strip()
        try:
            candidate_id = int(candidate_id)
        except ValueError:
            print("❌ 无效的ID")
            return

        candidate = self.engine.data.get_candidate(candidate_id)
        if not candidate:
            print(f"❌ 未找到候选人 ID: {candidate_id}")
            return

        current_stage = self.STAGE_NAMES.get(candidate.stage, candidate.stage)
        print(f"当前候选人: {candidate.name}，当前阶段: {current_stage}")

        confirm = input("确认推进到下一阶段? (y/n): ").strip().lower()
        if confirm == "y":
            if self.engine.advance_candidate(candidate_id):
                new_stage = self.STAGE_NAMES.get(candidate.stage, candidate.stage)
                print(f"✅ 已推进到: {new_stage}")
            else:
                print("❌ 推进失败（可能已到最后阶段）")

    def _action_score_candidate(self):
        """为候选人评分"""
        candidate_id = input("\n请输入候选人ID: ").strip()
        try:
            candidate_id = int(candidate_id)
        except ValueError:
            print("❌ 无效的ID")
            return

        candidate = self.engine.data.get_candidate(candidate_id)
        if not candidate:
            print(f"❌ 未找到候选人 ID: {candidate_id}")
            return

        print(f"\n候选人: {candidate.name}")
        print("评分维度: technical_skills, problem_solving, communication, collaboration, growth_mindset")
        print("评分范围: 1-5")

        category = input("评分维度: ").strip()
        score_str = input("评分 (1-5): ").strip()
        evidence = input("评分依据 (必填，记录具体行为/产出): ").strip()
        interviewer = input("面试官 (可选): ").strip()

        try:
            score = int(score_str)
        except ValueError:
            print("❌ 评分必须为数字")
            return

        if self.engine.score_candidate(
            candidate_id, category, score, evidence=evidence, interviewer=interviewer
        ):
            print(f"✅ 评分已记录: {category} = {score}")
        else:
            print("❌ 评分失败")

    def _action_recommendation(self):
        """查看录用建议"""
        candidate_id = input("\n请输入候选人ID: ").strip()
        try:
            candidate_id = int(candidate_id)
        except ValueError:
            print("❌ 无效的ID")
            return

        recommendation = self.engine.get_recommendation(candidate_id)
        if recommendation:
            print(f"\n💡 录用建议: {recommendation}")
        else:
            print("❌ 未找到候选人")

    def _action_generate_report(self):
        """生成报告"""
        print("\n--- 生成招聘报告 ---")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        default_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            f"recruitment_report_{timestamp}.md",
        )
        output_path = input(f"输出路径 (默认: {default_path}): ").strip() or default_path

        report = self.engine.generate_report(output_path)
        print(f"\n📄 报告预览 (前500字):\n")
        print(report[:500] + "..." if len(report) > 500 else report)
        print(f"\n✅ 完整报告已保存到: {output_path}")

    def _action_statistics(self):
        """查看统计数据"""
        stats = self.engine.data.get_statistics()
        print("\n--- 招聘统计 ---")
        print(f"候选人总数: {stats['total_candidates']}")
        print(f"活跃候选人: {stats['active_candidates']}")
        print(f"已录用: {stats['hired']}")
        print(f"已拒绝: {stats['rejected']}")
        print(f"录用率: {stats['hired_rate']}%")

        if stats["role_distribution"]:
            print("\n岗位分布:")
            for role, count in sorted(stats["role_distribution"].items(), key=lambda x: -x[1]):
                print(f"  {role}: {count}人")

        if stats["source_distribution"]:
            print("\n来源渠道:")
            for source, count in sorted(stats["source_distribution"].items(), key=lambda x: -x[1]):
                print(f"  {source}: {count}人")

        if stats["funnel_conversion"]:
            print("\n阶段转化率:")
            for transition, rate in stats["funnel_conversion"].items():
                start, end = transition.split("_to_")
                print(f"  {self.STAGE_NAMES.get(start, start)} → {self.STAGE_NAMES.get(end, end)}: {rate}%")

    def _action_capabilities(self):
        """查看核心能力"""
        print("\n--- 核心能力 ---")
        for index, capability in enumerate(self.engine.get_system_capabilities(), start=1):
            print(f"{index}. {capability}")

    def _action_save_config(self):
        """保存默认配置"""
        path = input("\n配置文件保存路径 (回车使用默认): ").strip() or None
        if self.engine.config.save_default_config(path):
            print("✅ 配置文件已保存")
        else:
            print("❌ 保存失败")

    @staticmethod
    def _action_exit():
        """退出程序"""
        print(f"\n👋 感谢使用 {APP_NAME}，再见！")
        sys.exit(0)


# ============================================================
# 非交互模式（命令行参数）
# ============================================================

def run_non_interactive(args):
    """非交互模式运行"""
    config = ConfigManager(args.config)
    data = DataStore(args.data)
    engine = RecruitmentEngine(config, data)

    if args.command == "add":
        if not args.name or not args.role:
            print("错误: --name 和 --role 为必填参数")
            sys.exit(1)
        candidate = engine.add_candidate(
            name=args.name,
            role=args.role,
            source=args.source or "",
            email=args.email or "",
            phone=args.phone or "",
        )
        if candidate:
            print(f"候选人已添加: {candidate.name} (ID: {candidate.id})")
        else:
            print("添加失败")
            sys.exit(1)

    elif args.command == "list":
        candidates = data.get_active_candidates()
        if not candidates:
            print("暂无活跃候选人")
            return
        print(f"{'ID':<5} {'姓名':<15} {'岗位':<20} {'阶段':<12}")
        print("-" * 55)
        for c in candidates:
            print(f"{c.id:<5} {c.name:<15} {c.role:<20} {c.stage:<12}")

    elif args.command == "advance":
        if not args.id:
            print("错误: --id 为必填参数")
            sys.exit(1)
        if engine.advance_candidate(int(args.id)):
            candidate = data.get_candidate(int(args.id))
            print(f"已推进: {candidate.name} → {candidate.stage}")
        else:
            print("推进失败")

    elif args.command == "score":
        if not all([args.id, args.category, args.score]):
            print("错误: --id, --category, --score 为必填参数")
            sys.exit(1)
        if engine.score_candidate(
            int(args.id), args.category, int(args.score),
            evidence=args.evidence or "", interviewer=args.interviewer or "",
        ):
            print(f"评分已记录: {args.category} = {args.score}")
        else:
            print("评分失败")

    elif args.command == "report":
        output = args.output or f"recruitment_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        report = engine.generate_report(output)
        print(report)

    elif args.command == "stats":
        stats = data.get_statistics()
        print(json.dumps(stats, ensure_ascii=False, indent=2))

    elif args.command == "recommend":
        if not args.id:
            print("错误: --id 为必填参数")
            sys.exit(1)
        rec = engine.get_recommendation(int(args.id))
        if rec:
            print(f"录用建议: {rec}")
        else:
            print("未找到候选人")

    elif args.command == "pipeline":
        pipeline_data = {
            "stages": PIPELINE_STAGES,
            "stage_names": RecruitmentCLI.STAGE_NAMES,
            "interview_types": INTERVIEW_TYPES,
            "scoring_weights": config.get("scoring.weights", {}),
            "targets": config.get("targets", {}),
        }
        print(json.dumps(pipeline_data, ensure_ascii=False, indent=2))

    elif args.command == "capabilities":
        for index, capability in enumerate(engine.get_system_capabilities(), start=1):
            print(f"{index}. {capability}")


# ============================================================
# 主入口
# ============================================================

def main():
    """主入口函数"""
    parser = argparse.ArgumentParser(
        description=f"{APP_NAME} v{APP_VERSION} - 智能招聘管道管理系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 recruitment_app.py                    # 启动交互式界面
  python3 recruitment_app.py add --name "张三" --role "Java开发"
  python3 recruitment_app.py list
  python3 recruitment_app.py advance --id 1
  python3 recruitment_app.py score --id 1 --category technical_skills --score 4
  python3 recruitment_app.py report
  python3 recruitment_app.py stats
  python3 recruitment_app.py recommend --id 1
  python3 recruitment_app.py pipeline
  python3 recruitment_app.py capabilities
        """,
    )

    parser.add_argument("--config", help="配置文件路径", default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--data", help="数据文件路径", default=DEFAULT_DATA_PATH)
    parser.add_argument("--log-dir", help="日志目录", default=None)
    parser.add_argument("--log-level", help="日志级别", default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"])

    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # add 命令
    add_parser = subparsers.add_parser("add", help="添加候选人")
    add_parser.add_argument("--name", required=True, help="候选人姓名")
    add_parser.add_argument("--role", required=True, help="应聘岗位")
    add_parser.add_argument("--source", help="来源渠道")
    add_parser.add_argument("--email", help="邮箱")
    add_parser.add_argument("--phone", help="电话")

    # list 命令
    subparsers.add_parser("list", help="列出所有活跃候选人")

    # advance 命令
    adv_parser = subparsers.add_parser("advance", help="推进候选人阶段")
    adv_parser.add_argument("--id", required=True, help="候选人ID")

    # score 命令
    score_parser = subparsers.add_parser("score", help="为候选人评分")
    score_parser.add_argument("--id", required=True, help="候选人ID")
    score_parser.add_argument("--category", required=True, help="评分维度")
    score_parser.add_argument("--score", required=True, help="评分 (1-5)")
    score_parser.add_argument("--evidence", required=True, help="评分依据（必填，记录具体行为/产出）")
    score_parser.add_argument("--interviewer", help="面试官")

    # report 命令
    report_parser = subparsers.add_parser("report", help="生成招聘报告")
    report_parser.add_argument("--output", help="报告输出路径")

    # stats 命令
    subparsers.add_parser("stats", help="查看统计数据")

    # recommend 命令
    rec_parser = subparsers.add_parser("recommend", help="查看录用建议")
    rec_parser.add_argument("--id", required=True, help="候选人ID")

    # pipeline 命令
    subparsers.add_parser("pipeline", help="查看管道配置")

    # capabilities 命令
    subparsers.add_parser("capabilities", help="查看招聘助手核心能力")

    args = parser.parse_args()

    # 配置日志
    if args.log_dir:
        global logger
        logger = setup_logging(args.log_dir, args.log_level)

    if args.command:
        # 非交互模式
        run_non_interactive(args)
    else:
        # 交互模式
        config = ConfigManager(args.config)
        data = DataStore(args.data)
        engine = RecruitmentEngine(config, data)
        cli = RecruitmentCLI(engine)
        try:
            cli.run()
        except KeyboardInterrupt:
            print(f"\n\n👋 感谢使用 {APP_NAME}，再见！")
            sys.exit(0)


if __name__ == "__main__":
    main()
