#!/usr/bin/env python3
"""
图片下载工具 (优化版)
=====================
用于从URL下载图片并保存到本地

优化内容：
1. 添加重试机制（指数退避）
2. 添加文件名冲突处理（自动重命名）
3. 添加下载进度显示
4. 支持批量下载
5. SSL验证可配置（默认启用）
6. 更完善的错误处理
7. 优化代码结构，import 移至模块顶部
8. 添加文件大小限制
9. 添加超时配置
"""

import os
import sys
import time
import argparse
import logging
import requests
from urllib.parse import urlparse, unquote
from pathlib import Path
from typing import Optional

# ============================================================
# 日志配置
# ============================================================

logger = logging.getLogger("download_image")

# ============================================================
# 常量定义
# ============================================================

DEFAULT_TIMEOUT = 30          # 默认超时时间（秒）
MAX_FILE_SIZE = 50 * 1024 * 1024  # 最大文件大小 50MB
MAX_RETRIES = 3               # 最大重试次数
RETRY_BACKOFF = 2             # 重试退避基数（秒）
DEFAULT_CHUNK_SIZE = 8192     # 默认下载块大小

# 请求头
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


# ============================================================
# 工具函数
# ============================================================

def sanitize_filename(filename: str, max_length: int = 200) -> str:
    """清理文件名，移除非法字符"""
    # 移除路径分隔符和其他非法字符
    illegal_chars = '<>:"/\\|?*\x00-\x1f'
    for char in illegal_chars:
        filename = filename.replace(char, "_")

    # URL解码
    filename = unquote(filename)

    # 去除首尾空格和点
    filename = filename.strip(". ")

    # 截断过长的文件名
    if len(filename) > max_length:
        name, ext = os.path.splitext(filename)
        filename = name[: max_length - len(ext)] + ext

    # 如果文件名为空，使用时间戳
    if not filename:
        filename = f"image_{int(time.time())}.jpg"

    return filename


def resolve_filename_conflict(save_path: Path) -> Path:
    """处理文件名冲突，自动添加序号"""
    if not save_path.exists():
        return save_path

    stem = save_path.stem
    suffix = save_path.suffix
    parent = save_path.parent
    counter = 1

    while True:
        new_path = parent / f"{stem}_{counter}{suffix}"
        if not new_path.exists():
            return new_path
        counter += 1
        if counter > 1000:
            # 安全限制，避免无限循环
            return parent / f"{stem}_{int(time.time())}{suffix}"


def format_size(size_bytes: int) -> str:
    """格式化文件大小"""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# ============================================================
# 核心下载函数
# ============================================================

def download_image(
    image_url: str,
    output_dir: str = "./downloaded_images",
    verify_ssl: bool = True,
    timeout: int = DEFAULT_TIMEOUT,
    max_retries: int = MAX_RETRIES,
    show_progress: bool = True,
) -> str:
    """
    从URL下载图片并保存到本地

    Args:
        image_url: 图片URL
        output_dir: 输出目录
        verify_ssl: 是否验证SSL证书
        timeout: 请求超时时间（秒）
        max_retries: 最大重试次数
        show_progress: 是否显示下载进度

    Returns:
        下载成功的图片本地路径

    Raises:
        ValueError: URL格式无效
        Exception: 下载失败
    """
    # 验证URL
    if not image_url or not image_url.startswith(("http://", "https://")):
        raise ValueError(f"无效的图片URL: {image_url}")

    parsed_url = urlparse(image_url)
    headers = {**DEFAULT_HEADERS, "Referer": f"{parsed_url.scheme}://{parsed_url.netloc}"}

    # 创建输出目录
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # 生成文件名
    raw_filename = os.path.basename(parsed_url.path)
    filename = sanitize_filename(raw_filename)
    save_path = output_path / filename
    save_path = resolve_filename_conflict(save_path)

    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            logger.debug(f"下载尝试 {attempt}/{max_retries}: {image_url}")

            # 流式下载，支持大文件和进度显示
            response = requests.get(
                image_url,
                headers=headers,
                timeout=timeout,
                verify=verify_ssl,
                allow_redirects=True,
                stream=True,
            )
            response.raise_for_status()

            # 检查Content-Type
            content_type = response.headers.get("Content-Type", "")
            if content_type and not content_type.startswith("image/"):
                raise Exception(
                    f"URL返回的不是图片内容，Content-Type: {content_type}"
                )

            # 检查文件大小
            content_length = int(response.headers.get("Content-Length", 0))
            if content_length > MAX_FILE_SIZE:
                raise Exception(
                    f"文件过大: {format_size(content_length)}，超过限制 {format_size(MAX_FILE_SIZE)}"
                )

            # 下载文件内容
            downloaded_size = 0
            with open(save_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=DEFAULT_CHUNK_SIZE):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)

                        # 进度显示
                        if show_progress and content_length > 0:
                            progress = downloaded_size / content_length * 100
                            sys.stdout.write(
                                f"\r  下载进度: {progress:.1f}% "
                                f"({format_size(downloaded_size)}/{format_size(content_length)})"
                            )
                            sys.stdout.flush()

            if show_progress:
                sys.stdout.write("\n")

            # 验证下载的文件
            actual_size = save_path.stat().st_size
            if actual_size == 0:
                save_path.unlink()
                raise Exception("下载的文件为空")

            logger.info(f"下载成功: {save_path} ({format_size(actual_size)})")
            return str(save_path)

        except requests.exceptions.SSLError as e:
            last_error = e
            logger.warning(f"SSL错误 (尝试 {attempt}/{max_retries}): {e}")
            if not verify_ssl and attempt == max_retries:
                break

        except requests.exceptions.ConnectionError as e:
            last_error = e
            logger.warning(f"连接失败 (尝试 {attempt}/{max_retries}): {e}")

        except requests.exceptions.Timeout as e:
            last_error = e
            logger.warning(f"请求超时 (尝试 {attempt}/{max_retries}): {e}")

        except requests.exceptions.HTTPError as e:
            last_error = e
            status_code = e.response.status_code if e.response is not None else "未知"
            logger.warning(f"HTTP错误 {status_code} (尝试 {attempt}/{max_retries}): {e}")
            # 4xx错误不需要重试
            if e.response is not None and 400 <= e.response.status_code < 500:
                break

        except requests.exceptions.RequestException as e:
            last_error = e
            logger.warning(f"请求失败 (尝试 {attempt}/{max_retries}): {e}")

        except Exception as e:
            last_error = e
            logger.warning(f"下载失败 (尝试 {attempt}/{max_retries}): {e}")

        # 重试等待（指数退避）
        if attempt < max_retries:
            wait_time = RETRY_BACKOFF ** attempt
            logger.debug(f"等待 {wait_time} 秒后重试...")
            time.sleep(wait_time)

    # 所有重试都失败
    error_msg = f"下载失败（已重试 {max_retries} 次）: {last_error}"
    logger.error(error_msg)
    raise Exception(error_msg)


def download_batch(
    image_urls: list[str],
    output_dir: str = "./downloaded_images",
    verify_ssl: bool = True,
    timeout: int = DEFAULT_TIMEOUT,
    max_retries: int = MAX_RETRIES,
    show_progress: bool = True,
) -> dict:
    """
    批量下载图片

    Args:
        image_urls: 图片URL列表
        output_dir: 输出目录
        verify_ssl: 是否验证SSL证书
        timeout: 请求超时时间
        max_retries: 最大重试次数
        show_progress: 是否显示下载进度

    Returns:
        包含成功和失败结果的字典
    """
    results = {
        "success": [],
        "failed": [],
        "total": len(image_urls),
    }

    if not image_urls:
        logger.warning("URL列表为空，无图片需要下载")
        return results

    print(f"\n开始批量下载 {len(image_urls)} 张图片...")
    start_time = time.time()

    for i, url in enumerate(image_urls, 1):
        print(f"\n[{i}/{len(image_urls)}] 下载: {url[:80]}...")
        try:
            local_path = download_image(
                url,
                output_dir=output_dir,
                verify_ssl=verify_ssl,
                timeout=timeout,
                max_retries=max_retries,
                show_progress=show_progress,
            )
            results["success"].append({"url": url, "path": local_path})
        except Exception as e:
            results["failed"].append({"url": url, "error": str(e)})

    elapsed = time.time() - start_time
    print(f"\n{'='*50}")
    print(f"批量下载完成！")
    print(f"  总计: {results['total']} 张")
    print(f"  成功: {len(results['success'])} 张")
    print(f"  失败: {len(results['failed'])} 张")
    print(f"  耗时: {elapsed:.1f} 秒")

    if results["failed"]:
        print(f"\n失败列表:")
        for item in results["failed"]:
            print(f"  ❌ {item['url'][:60]}... - {item['error']}")

    return results


# ============================================================
# 主入口
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="图片下载工具 (优化版)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 下载单张图片
  python3 download_image.py --image-url https://example.com/image.jpg

  # 下载到指定目录
  python3 download_image.py --image-url https://example.com/image.jpg --output-dir ./images

  # 批量下载
  python3 download_image.py --batch urls.txt --output-dir ./images

  # 禁用SSL验证
  python3 download_image.py --image-url https://example.com/image.jpg --no-verify-ssl
        """,
    )

    parser.add_argument("--image-url", help="单张图片URL")
    parser.add_argument("--output-dir", default="./downloaded_images", help="输出目录")
    parser.add_argument("--batch", help="批量下载：包含URL列表的文件路径（每行一个URL）")
    parser.add_argument("--no-verify-ssl", action="store_true", help="禁用SSL证书验证")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"超时时间（秒，默认{DEFAULT_TIMEOUT}）")
    parser.add_argument("--max-retries", type=int, default=MAX_RETRIES, help=f"最大重试次数（默认{MAX_RETRIES}）")
    parser.add_argument("--quiet", action="store_true", help="安静模式，不显示下载进度")
    parser.add_argument("--verbose", action="store_true", help="详细日志模式")

    args = parser.parse_args()

    # 配置日志
    log_level = logging.DEBUG if args.verbose else logging.WARNING
    logging.basicConfig(
        level=log_level,
        format="[%(levelname)s] %(message)s",
    )

    show_progress = not args.quiet

    if args.batch:
        # 批量下载模式
        if not os.path.exists(args.batch):
            print(f"ERROR: 批量文件不存在: {args.batch}", file=sys.stderr)
            sys.exit(1)

        with open(args.batch, "r", encoding="utf-8") as f:
            urls = [line.strip() for line in f if line.strip() and line.strip().startswith("http")]

        if not urls:
            print("ERROR: 批量文件中没有有效的URL", file=sys.stderr)
            sys.exit(1)

        results = download_batch(
            urls,
            output_dir=args.output_dir,
            verify_ssl=not args.no_verify_ssl,
            timeout=args.timeout,
            max_retries=args.max_retries,
            show_progress=show_progress,
        )

        # 输出结果摘要
        print(f"\nSUCCESS:{len(results['success'])} downloaded, {len(results['failed'])} failed")

    elif args.image_url:
        # 单张下载模式
        try:
            local_path = download_image(
                args.image_url,
                output_dir=args.output_dir,
                verify_ssl=not args.no_verify_ssl,
                timeout=args.timeout,
                max_retries=args.max_retries,
                show_progress=show_progress,
            )
            print(f"SUCCESS:{local_path}")
        except Exception as e:
            print(f"ERROR:{str(e)}", file=sys.stderr)
            sys.exit(1)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
