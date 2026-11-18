import math
import os
import struct

# Green wall: rotated +X. Second wall: rotated -Z.
# Measured world planes (unit normals).
green_n = (0.677, 0.736)
green_off = -432.0  # n · p
side_n = (0.736, -0.677)
side_point = (-562.0, -136.0)
side_off = side_n[0] * side_point[0] + side_n[1] * side_point[1]

theta = math.atan2(green_n[1], green_n[0])
c = math.cos(theta)
s = math.sin(theta)
print(f"theta={math.degrees(theta):.1f} cos={c:.3f} sin={s:.3f} side_off={side_off:.1f}")

# Major baked planes from the earlier scan, centimeters.
x_walls = [-825, -810, -390, -360, -345, -300, -255, -240, 165, 180, 270]
z_walls = [-900, -510, -405, -30, 0, 30, 60, 75, 450]

cam = (-162.0, 0.0, -235.0)
look = (-0.91, -0.36, 0.21)
ty = -136.0

root = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"


def bbox(path):
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
    step = max(1, n // 40)
    xs, ys, zs = [], [], []
    for v in range(0, n, step):
        x, y, z = struct.unpack_from("<3f", data, base + voff + v * 48)
        xs.append(x * 100)
        ys.append(y * 100)
        zs.append(z * 100)
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)


meshes = []
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith(".mesh"):
            continue
        if not (fn.startswith("chair") or fn.startswith("table") or fn.startswith("shelf") or fn.startswith("werdrobe")):
            continue
        b = bbox(os.path.join(dp, fn))
        if not b:
            continue
        meshes.append((fn, b))


def solve(wall_x, wall_z):
    # c*Tx + s*Tz = green_off - wall_x
    # s*Tx - c*Tz = side_off + wall_z
    rhs1 = green_off - wall_x
    rhs2 = side_off + wall_z
    # [c s; s -c] [Tx; Tz] = [rhs1; rhs2]
    det = -c * c - s * s
    tx = (-c * rhs1 - s * rhs2) / det
    tz = (-s * rhs1 + c * rhs2) / det
    return tx, tz


def world_of(x, z, tx, tz):
    return (x * c - z * s + tx, x * s + z * c + tz)


best = []
for wx in x_walls:
    for wz in z_walls:
        tx, tz = solve(wx, wz)
        # verify the wall point maps onto the measured plane
        gx, gz = world_of(wx, 0, tx, tz)
        if abs(green_n[0] * gx + green_n[1] * gz - green_off) > 2:
            continue
        hits = []
        for fn, (x0, y0, z0, x1, y1, z1) in meshes:
            cx, cz = world_of((x0 + x1) * 0.5, (z0 + z1) * 0.5, tx, tz)
            cy = (y0 + y1) * 0.5 + ty
            dx, dy, dz = cx - cam[0], cy - cam[1], cz - cam[2]
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            along = dx * look[0] + dy * look[1] + dz * look[2]
            if 40 < along < 320 and dist < 360 and (y1 - y0) > 25:
                hits.append((along, fn))
        if len(hits) >= 4:
            best.append((len(hits), wx, wz, tx, tz, hits[:8]))

best.sort(key=lambda r: -r[0])
for row in best[:8]:
    count, wx, wz, tx, tz, hits = row
    names = ", ".join(f"{fn}:{along:.0f}" for along, fn in hits)
    print(f"walls x={wx:.0f} z={wz:.0f} T=({tx:.0f},{ty:.0f},{tz:.0f}) inView={count} {names}")
