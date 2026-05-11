#!/usr/bin/env python3
"""
生成浏览器插件图标
需要安装 Pillow: pip install Pillow
"""

import os

def generate_icons():
    """生成简单的插件图标"""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        # 如果没有 Pillow，创建简单的 SVG 图标
        create_svg_icons()
        return

    sizes = [16, 48, 128]
    icon_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "browser-extension", "icons")
    os.makedirs(icon_dir, exist_ok=True)

    for size in sizes:
        img = Image.new("RGBA", (size, size), (0, 179, 138, 255))
        draw = ImageDraw.Draw(img)

        # 绘制圆角矩形背景
        margin = max(1, size // 16)
        draw.rounded_rectangle(
            [margin, margin, size - margin, size - margin],
            radius=size // 4,
            fill=(0, 179, 138, 255),
        )

        # 绘制机器人图标（简单的眼睛和嘴巴）
        center_x = size // 2
        center_y = size // 2

        # 眼睛
        eye_size = max(2, size // 8)
        eye_y = center_y - size // 8
        draw.ellipse(
            [center_x - size // 4 - eye_size, eye_y - eye_size,
             center_x - size // 4 + eye_size, eye_y + eye_size],
            fill="white",
        )
        draw.ellipse(
            [center_x + size // 4 - eye_size, eye_y - eye_size,
             center_x + size // 4 + eye_size, eye_y + eye_size],
            fill="white",
        )

        # 嘴巴
        mouth_y = center_y + size // 6
        mouth_width = size // 3
        draw.arc(
            [center_x - mouth_width, mouth_y - mouth_width // 2,
             center_x + mouth_width, mouth_y + mouth_width],
            0, 180,
            fill="white",
            width=max(1, size // 16),
        )

        # 天线
        antenna_y = margin + size // 6
        draw.line(
            [center_x, margin + size // 4, center_x, antenna_y],
            fill="white",
            width=max(1, size // 16),
        )
        draw.ellipse(
            [center_x - eye_size // 2, antenna_y - eye_size // 2,
             center_x + eye_size // 2, antenna_y + eye_size // 2],
            fill="white",
        )

        filepath = os.path.join(icon_dir, f"icon{size}.png")
        img.save(filepath)
        print(f"图标已生成: {filepath}")


def create_svg_icons():
    """创建 SVG 格式图标作为备选"""
    icon_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "browser-extension", "icons")
    os.makedirs(icon_dir, exist_ok=True)

    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#00b38a"/>
  <circle cx="44" cy="52" r="10" fill="white"/>
  <circle cx="84" cy="52" r="10" fill="white"/>
  <path d="M 40 80 Q 64 100 88 80" stroke="white" stroke-width="5" fill="none" stroke-linecap="round"/>
  <line x1="64" y1="16" x2="64" y2="32" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <circle cx="64" cy="12" r="5" fill="white"/>
</svg>'''

    svg_path = os.path.join(icon_dir, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"SVG图标已生成: {svg_path}")
    print("提示: 安装 Pillow (pip install Pillow) 可生成 PNG 图标")


if __name__ == "__main__":
    generate_icons()
