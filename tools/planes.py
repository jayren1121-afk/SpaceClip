import math
import os
import struct
from collections import defaultdict

root = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"


def load(path):
    data = open(path, "rb").read()
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    if i < 0 or j < 0:
        return None
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    ilen, ioff = struct.unpack_from("<II", head, j + 6)
    if vlen > 3_000_000:
        return None
    base = len(data) - max(voff + vlen, ioff + ilen)
    n = vlen // 48
    step = max(1, n // 2500)
    pos = {}
    for v in range(0, n, step):
        pos[v] = struct.unpack_from("<3f", data, base + v * 48)
    idx = struct.unpack_from("<" + "H" * (ilen // 2), data, base + ioff)
    return pos, idx, n


# axis planes: key (axis, rounded offset cm)
planes = defaultdict(float)
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith(".mesh"):
            continue
        loaded = load(os.path.join(dp, fn))
        if not loaded:
            continue
        pos, idx, n = loaded
        for t in range(0, len(idx) - 2, 3):
            if idx[t] not in pos or idx[t + 1] not in pos or idx[t + 2] not in pos:
                continue
            a, b, c = pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]]
            nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
            ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
            nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            area = math.sqrt(nx * nx + ny * ny + nz * nz)
            if area < 1e-4:
                continue
            nx, ny, nz = nx / area, ny / area, nz / area
            mid = ((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3)
            if abs(ny) < 0.25 and abs(nx) > 0.85:
                key = ("x", round(mid[0] * 100 / 15) * 15)
                planes[key] += area
            elif abs(ny) < 0.25 and abs(nz) > 0.85:
                key = ("z", round(mid[1] * 100 / 15) * 15)
                planes[key] += area

xs = sorted((k, v) for k, v in planes.items() if k[0] == "x")
zs = sorted((k, v) for k, v in planes.items() if k[0] == "z")
print("X planes")
for k, v in xs:
    if v > 0.4:
        print(f"  x={k[1]:5d} area={v:.2f}")
print("Z planes")
for k, v in zs:
    if v > 0.4:
        print(f"  z={k[1]:5d} area={v:.2f}")
