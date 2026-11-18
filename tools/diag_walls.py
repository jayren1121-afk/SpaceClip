import math
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
    verts = [struct.unpack_from("<3f", data, base + voff + v * 48) for v in range(n)]
    ib = base + ioff
    idx = [struct.unpack_from("<H", data, ib + k * 2)[0] for k in range(ilen // 2)]
    return verts, idx


bins = {}
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith(".mesh"):
            continue
        loaded = load(os.path.join(dp, fn))
        if not loaded:
            continue
        verts, idx = loaded
        for t in range(0, len(idx) - 2, 3):
            a, b, c = verts[idx[t]], verts[idx[t + 1]], verts[idx[t + 2]]
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            length = (nx * nx + ny * ny + nz * nz) ** 0.5
            if length < 1e-6:
                continue
            area = length * 0.5
            nx, ny, nz = nx / length, ny / length, nz / length
            if abs(ny) > 0.3:
                continue
            if nx < 0 or (abs(nx) < 0.02 and nz < 0):
                nx, nz = -nx, -nz
            ang = round(math.degrees(math.atan2(nz, nx)) / 8) * 8
            mx = (a[0] + b[0] + c[0]) / 3
            mz = (a[2] + b[2] + c[2]) / 3
            # rebuild normal from the bucket angle so offsets compare
            rad = math.radians(ang)
            bx, bz = math.cos(rad), math.sin(rad)
            off = round((bx * mx + bz * mz) * 100 / 20) * 20
            key = (ang, off)
            slot = bins.setdefault(key, [0.0, {}])
            slot[0] += area
            slot[1][fn] = slot[1].get(fn, 0) + area

rows = sorted(bins.items(), key=lambda kv: -kv[1][0])
for (ang, off), (area, names) in rows:
    if area < 1.2:
        break
    top = sorted(names.items(), key=lambda kv: -kv[1])[:2]
    label = ", ".join(f"{n}:{a:.1f}" for n, a in top)
    print(f"ang={ang:4.0f} off={off:6.0f}cm area={area:6.2f} {label}")
