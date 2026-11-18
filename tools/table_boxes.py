import os
import struct

root = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"


def bbox(path):
    data = open(path, "rb").read()
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    if i < 0:
        return None
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    ilen, ioff = struct.unpack_from("<II", head, j + 6)
    base = len(data) - max(voff + vlen, ioff + ilen)
    n = vlen // 48
    xs, ys, zs = [], [], []
    for v in range(0, n, max(1, n // 400)):
        x, y, z = struct.unpack_from("<3f", data, base + v * 48)
        xs.append(x)
        ys.append(y)
        zs.append(z)
    return (min(xs) * 100, min(ys) * 100, min(zs) * 100, max(xs) * 100, max(ys) * 100, max(zs) * 100)


for dp, _, fns in os.walk(root):
    for fn in fns:
        low = fn.lower()
        if not fn.endswith(".mesh"):
            continue
        if not any(k in low for k in ("table", "chair", "shelf")):
            continue
        box = bbox(os.path.join(dp, fn))
        if not box:
            continue
        dx, dy, dz = box[3] - box[0], box[4] - box[1], box[5] - box[2]
        if dy < 20:
            continue
        print(f"{fn:16} size {dx:6.0f} {dy:6.0f} {dz:6.0f}  min {box[0]:7.0f} {box[1]:6.0f} {box[2]:7.0f}")
