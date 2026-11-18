import math
import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"
yaw = math.radians(137.1)
c, s = math.cos(yaw), math.sin(yaw)
tx, ty, tz = -775, -139, 47
hits = [(-567, -79, -76), (-590, -82, -102)]

def baked(wx, wy, wz):
    dx, dz = wx - tx, wz - tz
    return dx * c + dz * s, wy - ty, -dx * s + dz * c

for h in hits:
    print("hit baked", tuple(round(v) for v in baked(*h)))

def bounds(path):
    data = open(path, "rb").read()
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    if i < 0 or j < 0:
        return None
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    ilen, ioff = struct.unpack_from("<II", head, j + 6)
    if vlen < 48 or vlen % 48:
        return None
    base = len(data) - max(voff + vlen, ioff + ilen)
    if base < 64:
        return None
    n = vlen // 48
    mn = [1e9] * 3
    mx = [-1e9] * 3
    step = max(1, n // 400)
    ok = False
    for v in range(0, n, step):
        x, y, z = struct.unpack_from("<fff", data, base + v * 48)
        if max(abs(x), abs(y), abs(z)) > 30:
            return None
        ok = True
        for k, val in enumerate((x * 100, y * 100, z * 100)):
            mn[k] = min(mn[k], val)
            mx[k] = max(mx[k], val)
    return (mn, mx) if ok else None

rows = []
for dp, _, names in os.walk(ROOT):
    for fn in names:
        if not fn.endswith(".mesh"):
            continue
        b = bounds(os.path.join(dp, fn))
        if not b:
            continue
        mn, mx = b
        # distance of first hit's baked point to the top face
        qx, qy, qz = baked(*hits[0])
        cx = min(max(qx, mn[0]), mx[0])
        cz = min(max(qz, mn[2]), mx[2])
        d = math.sqrt((qx - cx) ** 2 + (qz - cz) ** 2 + (qy - mx[1]) ** 2)
        if d < 80:
            rows.append((d, fn, mn, mx))
rows.sort()
for d, fn, mn, mx in rows[:15]:
    print(f"{d:5.0f} {fn:16} topY={mx[1]:6.0f} x={mn[0]:6.0f}..{mx[0]:6.0f} z={mn[2]:6.0f}..{mx[2]:6.0f}")
