"""Generate TaskFlow icons (PNG sizes + ICO for Windows)."""
from PIL import Image, ImageDraw

ACCENT = (91, 127, 184, 255)  # #5B7FB8 slate-blue
WHITE = (255, 255, 255, 255)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Rounded square
    radius = int(size * 0.22)
    d.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=ACCENT)
    # Checkmark
    pad = size * 0.27
    pts = [
        (pad, size * 0.55),
        (size * 0.43, size * 0.72),
        (size - pad, size * 0.32),
    ]
    line_w = max(2, int(size * 0.10))
    d.line(pts, fill=WHITE, width=line_w, joint="curve")
    # Round line caps
    r = line_w / 2
    for x, y in pts:
        d.ellipse([(x - r, y - r), (x + r, y + r)], fill=WHITE)
    return img


sizes = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}
for name, s in sizes.items():
    draw_icon(s).save(f"/home/user/workspace/taskflow/src-tauri/icons/{name}")

# Multi-resolution ICO for Windows
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
images = [draw_icon(s) for s in ico_sizes]
images[0].save(
    "/home/user/workspace/taskflow/src-tauri/icons/icon.ico",
    format="ICO",
    sizes=[(s, s) for s in ico_sizes],
)
print("OK")
