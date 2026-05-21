"""
Generate minimal placeholder JPEG images for Comic2Ebook test samples.
Each image is a tiny valid JPEG (1x1 pixel) — just enough to verify
sorting, naming, and batch processing behavior.
"""
import struct, os

SAMPLES_DIR = os.path.join(os.path.dirname(__file__), '..', 'samples')

# Minimal valid JPEG (1x1 pixel, white)
# SOI + APP0 + DQT + SOF0 + DHT + SOS + ECS + EOI
MINI_JPEG = bytes([
    0xFF, 0xD8,  # SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,  # APP0
    0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,  # DQT
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,  # SOF0
    0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,  # DHT
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,  # SOS
    0x7F, 0xAA,  # ECS (1 byte)
    0xFF, 0xD9,  # EOI
])


def write_jpg(dir_path, name):
    path = os.path.join(dir_path, name)
    with open(path, 'wb') as f:
        f.write(MINI_JPEG)
    return path


def main():
    base = SAMPLES_DIR

    # Comic-A: 1.jpg ~ 10.jpg (natural sort test)
    d = os.path.join(base, 'Comic-A-1-10')
    for i in range(1, 11):
        write_jpg(d, f'{i}.jpg')
    print(f'[OK] Comic-A-1-10: 10 files (1.jpg ~ 10.jpg)')

    # Comic-B: 001.jpg ~ 010.jpg (zero-padded sort test)
    d = os.path.join(base, 'Comic-B-001-010')
    for i in range(1, 11):
        write_jpg(d, f'{i:03d}.jpg')
    print(f'[OK] Comic-B-001-010: 10 files (001.jpg ~ 010.jpg)')

    # Comic-C: Chinese filenames
    d = os.path.join(base, 'Comic-C-中文命名')
    ch_names = ['封面.jpg', '第1页.jpg', '第2页.jpg', '第3页.jpg', '第4页.jpg',
                '第5页.jpg', '第6页.jpg', '第7页.jpg', '第8页.jpg', '第9页.jpg', '第10页.jpg']
    for name in ch_names:
        write_jpg(d, name)
    print(f'[OK] Comic-C-中文命名: 11 files (中文文件名)')

    # Comic-D: Special chars in folder name AND filenames ([]()& etc.)
    d = os.path.join(base, 'Comic-D-特殊字符')
    special_names = [
        '01[cover].jpg',
        '02(page1).jpg',
        '03&04.jpg',
        '05(back).jpg',
        '06-front.jpg',
        '07_page.jpg',
        '08 test.jpg',
        '009-spread.jpg',
        '010-end.jpg',
    ]
    for name in special_names:
        write_jpg(d, name)
    # Also add a file to test output naming: folder name with reserved chars
    # (the folder "Comic-D-特殊字符" itself is the reserved-char test for output)
    print(f'[OK] Comic-D-特殊字符: 10 files (特殊字符文件夹名 + 文件含 []()&)')

    # Comic-E: Large batch (300 files for performance testing)
    d = os.path.join(base, 'Comic-E-大页数')
    for i in range(1, 301):
        write_jpg(d, f'{i:04d}.jpg')
    print(f'[OK] Comic-E-大页数: 300 files (大页数性能测试)')

    print(f'\n全部样例数据已生成: {base}')


if __name__ == '__main__':
    main()
