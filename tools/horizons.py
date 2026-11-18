import os
import struct

root = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"


def load(path):
    data = open(path, "rb").read()
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    if i < 0:
        return None
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    if j < 0:
        return None
    ilen, ioff = struct.unpack_from("<II", head, j + 6)
    base = len(data) - max(voff + vlen, ioff + ilen)
    n = vlen // 48
    verts = []
    for v in range(n):
        verts.append(struct.unpack_from("<3f", data, base + voff + v * 48))
    idx = []
    ib = base + ioff
    for k in range(ilen // 2):
        idx.append(struct.unpack_from("<H", data, ib + k * 2)[0])
    return verts, idx


rows = []
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith(".mesh"):
            continue
        loaded = load(os.path.join(dp, fn))
        if not loaded:
            continue
        verts, idx = loaded
        bins = {}
        for t in range(0, len(idx) - 2, 3):
            a, b, c = verts[idx[t]], verts[idx[t + 1]], verts[idx[t + 2]]
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            area = (nx * nx + ny * ny + nz * nz) ** 0.5 * 0.5
            if area < 1e-6 or ny < 0.85 * (area * 2):
                continue
            y = (a[1] + b[1] + c[1]) / 3
            key = round(y * 100 / 8) * 8
            slot = bins.setdefault(key, [0, 1e9, 1e9, -1e9, -1e9])
            slot[0] += area
            for p in (a, b, c):
                slot[1] = min(slot[1], p[0])
                slot[2] = min(slot[2], p[2])
                slot[3] = max(slot[3], p[0])
                slot[4] = max(slot[4], p[2])
        for y, (area, x0, z0, x1, z1) in bins.items():
            if area < 0.15 or not (40 <= y <= 90):
                continue
            rows.append((area, fn, y, (x1 - x0) * 100, (z1 - z0) * 100, x0 * 100, z0 * 100))

rows.sort(reverse=True)
for area, fn, y, dx, dz, x0, z0 in rows[:40]:
    print(f"{fn:20} y={y:5.0f} area={area:6.2f} size {dx:6.0f}x{dz:6.0f} at {x0:7.0f},{z0:7.0f}")
