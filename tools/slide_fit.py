import math
import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"

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
    mn = [1e9, 1e9, 1e9]
    mx = [-1e9, -1e9, -1e9]
    step = max(1, n // 800)
    for v in range(0, n, step):
        x, y, z = struct.unpack_from("<fff", data, base + v * 48)
        if max(abs(x), abs(y), abs(z)) > 30:
            return None
        for k, val in enumerate((x * 100, y * 100, z * 100)):
            mn[k] = min(mn[k], val)
            mx[k] = max(mx[k], val)
    return mn, mx

meshes = {}
for dp, _, names in os.walk(ROOT):
    for fn in names:
        if fn.endswith(".mesh"):
            b = bounds(os.path.join(dp, fn))
            if b:
                meshes[fn] = b

# tops: not a wall/floor, height 30-140, has a top near maxY
tops = []
for fn, (mn, mx) in meshes.items():
    sx, sy, sz = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
    low = fn.lower()
    if any(t in low for t in ("wall", "floor", "ceiling", "cornice", "door", "dor", "window", "pplane")):
        continue
    if sy < 25 or sy > 160 or sx < 30 or sz < 30 or sx > 200 or sz > 220:
        continue
    tops.append((fn, mn, mx))

green_n = (0.682, 0.732)
green_d = -432.0
# up hits ~56cm above floor y=-136 → y=-80
up_hits = [(-567, -79, -76), (-590, -82, -102), (-593, -135, -63)]
# the first two are raised
raised = [(-567, -79, -76), (-590, -82, -102)]
floor_y = -136
cam = (-162.0, 0.0, -235.0)
look = (-0.91, -0.357, 0.213)
ll = math.sqrt(sum(v * v for v in look))
look = tuple(v / ll for v in look)

yaw = math.atan2(green_n[1], green_n[0])
c, s = math.cos(yaw), math.sin(yaw)
print("yaw", yaw * 180 / math.pi)

# +X walls: thin in x, tall, floor center to the +x side
floor = meshes["floor.mesh"]
fcx = (floor[0][0] + floor[1][0]) * 0.5
fcz = (floor[0][2] + floor[1][2]) * 0.5
xwalls = []
for fn, (mn, mx) in meshes.items():
    sx, sy, sz = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
    if sy > 140 and sx < 40 and sz > 150 and fcx > (mn[0] + mx[0]) * 0.5:
        xwalls.append((fn, mx[0], mn[2], mx[2]))  # inner x, z range
        print("xwall", fn, "x", round(mx[0]), "z", round(mn[2]), round(mx[2]))

def world_of(x, y, z, tx, tz):
    return (x * c - z * s + tx, y + (floor_y - 3), x * s + z * c + tz)

def score(tx, tz):
    # raised hits should fall inside some top's xz and near its top y
    err = 0
    for hx, hy, hz in raised:
        # baked of hit
        dx, dz = hx - tx, hz - tz
        bx = dx * c + dz * s
        bz = -dx * s + dz * c
        by = hy - (floor_y - 3)
        best = 1e9
        for fn, mn, mx in tops:
            # distance to top rectangle
            cx = min(max(bx, mn[0]), mx[0])
            cz = min(max(bz, mn[2]), mx[2])
            dy = by - mx[1]
            d = math.sqrt((bx - cx) ** 2 + (bz - cz) ** 2 + dy * dy)
            if d < best:
                best = d
        err += best
    # chair56 in front of camera
    mn, mx = meshes["chair56.mesh"]
    wx, wy, wz = world_of((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2, tx, tz)
    dx, dy, dz = wx - cam[0], wy - cam[1], wz - cam[2]
    along = dx * look[0] + dy * look[1] + dz * look[2]
    side2 = dx * dx + dy * dy + dz * dz - along * along
    return err, along, math.sqrt(max(0, side2))

# For each x wall, Ux = q.x - P, but T is world translation.
# n·T = green_d - P
# tangent t = (-nz, nx), free s
for fn, P, z0, z1 in xwalls:
    nT = green_d - P
    print(f"\n{fn} P={P:.0f} nT={nT:.0f}")
    best = None
    for k in range(-40, 41):
        slide = k * 25  # cm along tangent
        tx = nT * green_n[0] + slide * (-green_n[1])
        tz = nT * green_n[1] + slide * green_n[0]
        err, along, side = score(tx, tz)
        if best is None or err < best[0]:
            best = (err, along, side, slide, tx, tz)
    print(f"  best err={best[0]:.0f} along={best[1]:.0f} side={best[2]:.0f} slide={best[3]:.0f} T=({best[4]:.0f},{best[5]:.0f})")
    # print where a few objects go
    tx, tz = best[4], best[5]
    for name in ("chair56", "chair58", "table17", "table", "shelf", "window2"):
        if name + ".mesh" not in meshes and name != "window2":
            continue
        key = name + ".mesh" if not name.endswith(".mesh") else name
        if key not in meshes:
            key = name + ".mesh"
        mn, mx = meshes[key]
        w = world_of((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2, tx, tz)
        dx, dy, dz = w[0] - cam[0], w[1] - cam[1], w[2] - cam[2]
        along = dx * look[0] + dy * look[1] + dz * look[2]
        side = math.sqrt(max(0, dx * dx + dy * dy + dz * dz - along * along))
        print(f"    {name:10} along={along:6.0f} side={side:5.0f} y={w[1]:6.0f}")
