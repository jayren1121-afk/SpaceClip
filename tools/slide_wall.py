import math
import os
import struct

c = math.cos(math.radians(47.4))
s = math.sin(math.radians(47.4))
root = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"
cam = (-162.0, 0.0, -235.0)
look = (-0.91, -0.36, 0.21)


def center(path):
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
    if n < 3:
        return None
    step = max(1, n // 50)
    xs, ys, zs = [], [], []
    for v in range(0, n, step):
        x, y, z = struct.unpack_from("<3f", data, base + voff + v * 48)
        xs.append(x * 100)
        ys.append(y * 100)
        zs.append(z * 100)
    if not xs:
        return None
    return (
        (min(xs) + max(xs)) / 2,
        (min(ys) + max(ys)) / 2,
        (min(zs) + max(zs)) / 2,
        max(ys) - min(ys),
    )


objs = []
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith(".mesh"):
            continue
        if not (fn.startswith("table") or fn.startswith("shelf") or fn.startswith("werdrobe") or fn.startswith("chair")):
            continue
        got = center(os.path.join(dp, fn))
        if got and got[3] > 28:
            objs.append((fn, got))

walls = [-825, -390, -360, -300, 165, 180, 270]
for wallx in walls:
    rhs = -432 - wallx
    best = {}
    for tz in range(-900, 1000, 15):
        tx = (rhs - s * tz) / c
        for fn, (bx, by, bz, h) in objs:
            wx = bx * c - bz * s + tx
            wz = bx * s + bz * c + tz
            if not (-680 < wx < -250 and -280 < wz < 40):
                continue
            dx, dy, dz = wx - cam[0], (by - 136) - cam[1], wz - cam[2]
            along = dx * look[0] + dy * look[1] + dz * look[2]
            if along < 120 or along > 420:
                continue
            prev = best.get(fn)
            if prev is None or abs(along - 280) < abs(prev[0] - 280):
                best[fn] = (along, tx, tz, wx, wz)
    print(f"wallX={wallx}")
    for fn, (along, tx, tz, wx, wz) in sorted(best.items(), key=lambda kv: kv[1][0])[:10]:
        print(f"  {fn:18} along={along:5.0f} T=({tx:6.0f},{tz:6.0f}) at {wx:6.0f},{wz:6.0f}")
