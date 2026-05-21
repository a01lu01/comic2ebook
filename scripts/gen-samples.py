"""
Generate test JPEG images for Comic2Ebook sample data.
Each image is white background with black page number text in center.
Usage: python scripts/gen-samples.py
"""

import os
from PIL import Image, ImageDraw, ImageFont


SAMPLES_DIR = os.path.join(os.path.dirname(__file__), '..', 'samples')


def make_page_image(page_num, width=800, height=1200, bg='white', fg='black'):
    """
    Create a comic page image: white background, black page number centered.
    Returns PIL Image object.
    """
    img = Image.new('RGB', (width, height), color=bg)
    draw = ImageDraw.Draw(img)

    # Try to load a font that supports Chinese characters
    font = None
    font_paths = [
        'C:/Windows/Fonts/msyh.ttc',      # Microsoft YaHei
        'C:/Windows/Fonts/simsun.ttc',     # SimSun
        'C:/Windows/Fonts/simhei.ttf',     # SimHei
    ]
    for fp in font_paths:
        try:
            font = ImageFont.truetype(fp, 180)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    # Draw page number
    text = str(page_num)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    pos = ((width - text_w) // 2, (height - text_h) // 2)
    draw.text(pos, text, fill=fg, font=font)

    # Light gray border for visual clarity
    draw.rectangle([10, 10, width - 10, height - 10], outline='#cccccc', width=3)

    return img


def generate_sample(name, page_specs):
    """
    Generate a sample comic folder.
    page_specs: list of (filename, page_number) tuples.
    """
    d = os.path.join(SAMPLES_DIR, name)
    os.makedirs(d, exist_ok=True)
    for fname, page_num in page_specs:
        img = make_page_image(page_num)
        path = os.path.join(d, fname)
        img.save(path, 'JPEG', quality=85)
    print(f'[OK] {name}: {len(page_specs)} pages')


def main():
    # Comic-A: 1.jpg ~ 10.jpg (natural sort test: 1,2,...,10 not 1,10,2)
    generate_sample('Comic-A-1-10', [
        ('1.jpg', 1), ('2.jpg', 2), ('3.jpg', 3), ('4.jpg', 4), ('5.jpg', 5),
        ('6.jpg', 6), ('7.jpg', 7), ('8.jpg', 8), ('9.jpg', 9), ('10.jpg', 10),
    ])

    # Comic-B: 001.jpg ~ 010.jpg (zero-padded, should sort same as A)
    generate_sample('Comic-B-001-010', [
        ('001.jpg', 1), ('002.jpg', 2), ('003.jpg', 3), ('004.jpg', 4), ('005.jpg', 5),
        ('006.jpg', 6), ('007.jpg', 7), ('008.jpg', 8), ('009.jpg', 9), ('010.jpg', 10),
    ])

    # Comic-C: Chinese filenames
    generate_sample('Comic-C-中文命名', [
        ('封面.jpg', '封面'), ('第1页.jpg', 1), ('第2页.jpg', 2), ('第3页.jpg', 3),
        ('第4页.jpg', 4), ('第5页.jpg', 5), ('第6页.jpg', 6), ('第7页.jpg', 7),
        ('第8页.jpg', 8), ('第9页.jpg', 9), ('第10页.jpg', 10),
    ])

    # Comic-D: Special chars in filenames
    generate_sample('Comic-D-特殊字符', [
        ('01[cover].jpg', '封面'), ('02(page1).jpg', 1), ('03&04.jpg', 2),
        ('05(back).jpg', 3), ('06-front.jpg', 4), ('07_page.jpg', 5),
        ('08 test.jpg', 6), ('009-spread.jpg', 7), ('010-end.jpg', 8),
    ])

    # Comic-E: Large batch (300 pages for performance testing)
    generate_sample('Comic-E-大页数', [
        (f'{i:04d}.jpg', i) for i in range(1, 301)
    ])

    print(f'\nDone. Samples in: {SAMPLES_DIR}')


if __name__ == '__main__':
    main()
