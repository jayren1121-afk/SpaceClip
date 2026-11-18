import math
import os
import struct

# Green wall is a baked +Z wall. yaw so +Z normal lands on (0.68, 0.74).
# R*(0,1) = (-sin, cos) = (0.68, 0.73)
theta = math.atan2(-0.68, 0.73)
c = math.cos(theta)
s = math.sin(theta)
print("theta", round(math.degrees(theta), 1))
root = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"
cam = (-162.0, 0.0, -235.0)
look = (-0.91, -0.36, 0.21)
green_off = -432.0


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
    step = max(1, n // 40)
    xs, ys, zs = [], [], []
    for v in range(0, n, step):
        x, y, z = struct.unpack_from("<3f", data, base + voff + v * 48)
        xs.append(x * 100)
        ys.append(y * 100)
        zs.append(z * 100)
    return (
        (min(xs) + max(xs)) / 2,
        (min(ys) + max(ys)) / 2,
        (min(zs) + max(zs)) / 2,
        max(ys) - min(ys),
        max(xs) - min(xs),
        max(zs) - min(zs),
    )


objs = []
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith(".mesh"):
            continue
        if not (fn.startswith("table") or fn.startswith("chair") or fn.startswith("shelf") or fn.startswith("werdrobe")):
            continue
        g = center(os.path.join(dp, fn))
        if g and g[3] > 25:
            objs.append((fn, g))

# +Z walls (constant z) with real area
z_walls = [-900, -510, -30, 0, 30, 60, 75, 450]
best = []
for wz in z_walls:
    # n·(R*p + T) = wz + (-s)*tx + c*tz = green_off
    # -s*tx + c*tz = green_off - wz
    rhs = green_off - wz
    for tx in range(-800, 800, 20):
        # -s*tx + c*tz = rhs => tz = (rhs + s*tx) / c
        tz = (rhs + s * tx) / c
        tables = chairs = shelves = 0
        names = []
        for fn, (bx, by, bz, h, dx, dz) in objs:
            wx = bx * c - bz * s + tx
            wz_w = bx * s + bz * c + tz
            wy = by - 136
            ddx, ddy, ddz = wx - cam[0], wy - cam[1], wz_w - cam[2]
            along = ddx * look[0] + ddy * look[1] + ddz * look[2]
            dist = math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
            if not (150 < along < 400 and dist < 450):
                continue
            if fn.startswith("table") and h > 40:
                tables += 1
            elif fn.startswith("chair"):
                chairs += 1
            elif fn.startswith("shelf") or fn.startswith("werdrobe"):
                shelves += 1
            names.append(fn)
        if tables >= 1 and chairs >= 2 and shelves >= 1:
            best.append((chairs + tables + shelves, wz, tx, tz, names[:8]))

best.sort(key=lambda r: -r[0])
for row in best[:6]:
    score, wz, tx, tz, names = row
    print(f"zWall={wz:5} T=({tx:5},{tz:6.0f}) score={score} {names}")
print("candidates", len(best))
