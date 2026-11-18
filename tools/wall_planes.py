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
    base = len(data) - max(voff + vlen, ioff + ilen)
    n = vlen // 48
    pos = [struct.unpack_from("<3f", data, base + v * 48) for v in range(n)]
    idx = struct.unpack_from("<" + "H" * (ilen // 2), data, base + ioff)
    return pos, idx


def planes(name):
    path = None
    for dp, _, fns in os.walk(root):
        if name in fns:
            path = os.path.join(dp, name)
            break
    loaded = load(path)
    if not loaded:
        return
    pos, idx = loaded
    buckets = defaultdict(lambda: [0.0, 0.0, 0.0, 0])
    for t in range(0, len(idx) - 2, 3):
        a, b, c = pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]]
        nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
        ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
        nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        area = math.sqrt(nx * nx + ny * ny + nz * nz)
        if area < 1e-6:
            continue
        nx, ny, nz = nx / area, ny / area, nz / area
        if abs(ny) > 0.4:
            continue
        key = (round(nx * 2) / 2, round(nz * 2) / 2)
        if key[0] < 0 or (key[0] == 0 and key[1] < 0):
            key = (-key[0], -key[1])
            nx, nz = -nx, -nz
        mid = ((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)
        bucket = buckets[key]
        bucket[0] += mid[0] * area
        bucket[1] += mid[1] * area
        bucket[2] += mid[2] * area
        bucket[3] += area
    print("\n", name)
    ranked = sorted(buckets.items(), key=lambda kv: kv[1][3], reverse=True)[:3]
    for key, (sx, sy, sz, area) in ranked:
        print(" ", key, "point cm", round(sx / area * 100), round(sy / area * 100), round(sz / area * 100), "area", round(area, 2))


for name in ["wall1.mesh", "wall4.mesh", "wall5.mesh", "wall22.mesh", "floor.mesh"]:
    planes(name)
