#!/usr/bin/env python3
"""
数据同步工具 - 将浏览器插件导出的简历数据导入到招聘助手系统
================================================================

使用方式:
  python3 sync_from_plugin.py --input resumes_2026-04-24.json
  python3 sync_from_plugin.py --input resumes_2026-04-24.json --data recruitment_data.json
  python3 sync_from_plugin.py --watch  # 监听模式，自动检测新文件
"""

import json
import os
import sys
import time
import argparse
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

# 导入招聘助手模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from recruitment_app import DataStore, Candidate, ConfigManager, PIPELINE_STAGES

# ============================================================
# 日志配置
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("sync_plugin")


# ============================================================
# 数据转换
# ============================================================

def plugin_data_to_candidate(plugin_resume: dict) -> Optional[Candidate]:
    """
    将浏览器插件导出的简历数据转换为 Candidate 对象

    插件数据格式:
    {
        "id": "xxx",
        "name": "张三",
        "role": "Java开发工程师",
        "education": "本科",
        "experience": "3-5年",
        "expectedSalary": "15-25K",
        "source": "BOSS直聘",
        "sourceUrl": "https://...",
        "receivedDate": "2026-04-24",
        ...
    }
    """
    name = plugin_resume.get("name", "").strip()
    role = plugin_resume.get("role", "").strip()

    if not name:
        logger.warning(f"简历数据缺少姓名，跳过: {plugin_resume.get('id', 'unknown')}")
        return None

    # 如果没有岗位信息，使用默认值
    if not role:
        role = "待确认岗位"

    # 构建备注信息
    notes = []
    if plugin_resume.get("education"):
        notes.append(f"学历: {plugin_resume['education']}")
    if plugin_resume.get("experience"):
        notes.append(f"经验: {plugin_resume['experience']}")
    if plugin_resume.get("expectedSalary"):
        notes.append(f"期望薪资: {plugin_resume['expectedSalary']}")
    if plugin_resume.get("currentCompany"):
        notes.append(f"当前公司: {plugin_resume['currentCompany']}")
    if plugin_resume.get("ageGender"):
        notes.append(f"{plugin_resume['ageGender']}")
    if plugin_resume.get("status"):
        notes.append(f"状态: {plugin_resume['status']}")
    if plugin_resume.get("summary"):
        notes.append(f"简介: {plugin_resume['summary'][:100]}")

    # 创建候选人对象
    candidate = Candidate(
        name=name,
        role=role,
        source=f"{plugin_resume.get('source', 'BOSS直聘')}（插件同步）",
        resume_url=plugin_resume.get("sourceUrl", ""),
    )

    # 设置阶段为 screening（简历筛选），因为简历已被接收
    candidate.stage = PIPELINE_STAGES[1]  # screening

    # 添加备注
    note_text = " | ".join(notes)
    if note_text:
        candidate.add_note(f"[插件同步] {note_text}")

    # 保存插件原始数据
    candidate.extra = {
        "plugin_id": plugin_resume.get("id", ""),
        "plugin_source": plugin_resume.get("source", "BOSS直聘"),
        "received_date": plugin_resume.get("receivedDate", ""),
        "received_time": plugin_resume.get("receivedTime", ""),
        "scraped_at": plugin_resume.get("scrapedAt", ""),
    }

    return candidate


# ============================================================
# 同步逻辑
# ============================================================

def sync_from_file(
    input_path: str,
    data_store: DataStore,
    skip_duplicates: bool = True,
) -> dict:
    """
    从插件导出的JSON文件同步数据

    Returns:
        同步结果统计
    """
    logger.info(f"开始同步文件: {input_path}")

    # 读取插件导出的JSON
    try:
        with open(input_path, "r", encoding="utf-8") as f:
            plugin_data = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.error(f"文件读取失败: {e}")
        return {"success": 0, "skipped": 0, "failed": 0, "error": str(e)}

    # 提取简历列表
    resumes = plugin_data.get("resumes", [])
    if not resumes:
        logger.warning("文件中没有简历数据")
        return {"success": 0, "skipped": 0, "failed": 0}

    logger.info(f"发现 {len(resumes)} 份简历数据")

    # 获取已有的插件ID集合（用于去重）
    existing_plugin_ids = set()
    if skip_duplicates:
        for c in data_store.candidates:
            pid = c.extra.get("plugin_id", "")
            if pid:
                existing_plugin_ids.add(pid)

    # 逐条处理
    stats = {"success": 0, "skipped": 0, "failed": 0}

    for resume_data in resumes:
        try:
            # 检查重复
            plugin_id = resume_data.get("id", "")
            if skip_duplicates and plugin_id and plugin_id in existing_plugin_ids:
                logger.debug(f"跳过重复简历: {resume_data.get('name', 'unknown')}")
                stats["skipped"] += 1
                continue

            # 转换并添加
            candidate = plugin_data_to_candidate(resume_data)
            if candidate:
                if data_store.add_candidate(candidate):
                    stats["success"] += 1
                    logger.info(f"✅ 同步成功: {candidate.name} - {candidate.role}")
                else:
                    stats["skipped"] += 1
            else:
                stats["failed"] += 1

        except Exception as e:
            logger.error(f"处理简历失败: {e}")
            stats["failed"] += 1

    logger.info(
        f"同步完成: 成功 {stats['success']}，跳过 {stats['skipped']}，失败 {stats['failed']}"
    )
    return stats


def watch_mode(
    watch_dir: str,
    data_store: DataStore,
    interval: int = 10,
):
    """
    监听模式：自动检测新的简历导出文件并同步

    Args:
        watch_dir: 监控目录
        data_store: 数据存储
        interval: 检查间隔（秒）
    """
    watch_path = Path(watch_dir)
    processed_files = set()

    logger.info(f"开始监听目录: {watch_dir}")
    logger.info(f"检查间隔: {interval} 秒")
    logger.info("按 Ctrl+C 停止监听")

    try:
        while True:
            # 扫描目录中的 JSON 文件
            for json_file in watch_path.glob("resumes_*.json"):
                if json_file.name in processed_files:
                    continue

                logger.info(f"检测到新文件: {json_file.name}")
                stats = sync_from_file(str(json_file), data_store)
                processed_files.add(json_file.name)

                # 同步成功后重命名文件（添加 .done 后缀）
                if stats["success"] > 0:
                    done_path = json_file.with_suffix(".json.done")
                    json_file.rename(done_path)
                    logger.info(f"文件已标记为已处理: {done_path.name}")

            time.sleep(interval)

    except KeyboardInterrupt:
        logger.info("监听已停止")


# ============================================================
# 主入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="招聘助手 - 浏览器插件数据同步工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 从JSON文件导入
  python3 sync_from_plugin.py --input resumes_2026-04-24.json

  # 指定数据文件路径
  python3 sync_from_plugin.py --input resumes.json --data ./recruitment_data.json

  # 监听模式
  python3 sync_from_plugin.py --watch ./downloads
        """,
    )

    parser.add_argument("--input", help="插件导出的JSON文件路径")
    parser.add_argument("--data", help="招聘助手数据文件路径", default=None)
    parser.add_argument("--watch", help="监听目录（自动检测新文件）")
    parser.add_argument("--interval", type=int, default=10, help="监听检查间隔（秒，默认10）")
    parser.add_argument("--no-skip-duplicates", action="store_true", help="不跳过重复简历")

    args = parser.parse_args()

    # 初始化数据存储
    config = ConfigManager()
    data = DataStore(args.data)

    if args.input:
        # 单文件同步模式
        stats = sync_from_file(
            args.input,
            data,
            skip_duplicates=not args.no_skip_duplicates,
        )
        print(f"\n同步结果: 成功 {stats['success']}，跳过 {stats['skipped']}，失败 {stats['failed']}")

    elif args.watch:
        # 监听模式
        watch_mode(args.watch, data, interval=args.interval)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
