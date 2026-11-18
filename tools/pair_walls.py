import math
import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"

def load(path):
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
    step = max(1, n // 500)
    pts = []
    for v in range(0, n, step):
        x, y, z, nx, ny, nz = struct.unpack_from("<ffffff", data, base + v * 48)
        if max(abs(x), abs(y), abs(z)) > 40:
            return None
        pts.append((x * 100, y * 100, z * 100, nx, ny, nz))
    return pts

files = {}
for dp, _, names in os.walk(ROOT):
    for fn in names:
        if fn.endswith(".mesh"):
            files[fn] = os.path.join(dp, fn)

planes = []
for fn, path in files.items():
    pts = load(path)
    if not pts:
        continue
    ys = [p[1] for p in pts]
    if max(ys) - min(ys) < 120:
        continue
    sx = sy = sz = 0
    c = 0
    for p in pts:
        if abs(p[4]) < 0.5:
            sx += p[3]
            sz += p[5]
            c += 1
    if c < 8:
        continue
    length = math.sqrt(sx * sx + sz * sz) or 1
    nx, nz = sx / length, sz / length
    # plane offset from verts with that normal
    offs = []
    for p in pts:
        if p[3] * nx + p[5] * nz > 0.8 and abs(p[4]) < 0.5:
            offs.append(p[0] * nx + p[2] * nz)
    if len(offs) < 5:
        continue
    offs.sort()
    d = offs[len(offs) // 2]
    xs = [p[0] for p in pts]
    zs = [p[2] for p in pts]
    planes.append((fn, nx, nz, d, min(xs), max(xs), min(zs), max(zs), min(ys), max(ys)))

print("planes", len(planes))

# world observations
# A green wall n=(0.682, 0.732) d=-432, representative points
green_n = (0.682, 0.732)
green_d = -432
green_pts = [(-400, -217), (-423, -196), (-381, -234)]
# B world +X n=(1,0) d=-561
plus_n = (1.0, 0.0)
plus_d = -561
plus_pt = (-561, -110)

def ang(x, z):
    return math.atan2(z, x)

def wrap(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a

hits = [
    ("green", green_n, green_d, green_pts),
    ("plusX", plus_n, plus_d, [plus_pt]),
]

# also the slanted hits
# (0.52, -0.85) at (-567, -142), (0.79, -0.61) at (-565, -143)
def norm(x, z):
    l = math.sqrt(x * x + z * z)
    return (x / l, z / l)

extra = [
    ("slant1", norm(0.52, -0.85), None, [(-567, -142)]),
    ("slant2", norm(0.79, -0.61), None, [(-565, -143)]),
]
for name, n, _, pts in extra:
    d = n[0] * pts[0][0] + n[1] * pts[0][1]
    hits.append((name, n, d, pts))

best = []
for i, a in enumerate(planes):
    for hname, hn, hd, hpts in hits:
        yaw = wrap(ang(hn[0], hn[1]) - ang(a[1], a[2]))
        # translation from this one plane is one equation. Score by how well OTHER world hits
        # land on some baked plane after this yaw and the T solved from this plane plus... 
        # T has 2 dof. Use this plane for one, and require another world hit to pick T.
        best.append((0, yaw, a[0], hname))  # placeholder

# For each baked plane paired with green wall (the reliable one), yaw is fixed.
# Then T is constrained by na·T = da_world - da_baked.
# Free direction is tangent. Slide T so the hit point's along coordinate matches the mesh extent center? 
# Better: for each other baked plane, solve T fully and test all world hits' distance to the nearest baked plane.

def solve_T(yaw, n1, d1_world, d1_baked, n2, d2_world, d2_baked):
    c, s = math.cos(yaw), math.sin(yaw)
    # world normal is already n1. Equation n·T = d_world - d_baked
    A = [
        [n1[0], n1[1], d1_world - d1_baked],
        [n2[0], n2[1], d2_world - d2_baked],
    ]
    det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
    if abs(det) < 0.25:
        return None
    tx = (A[0][2] * A[1][1] - A[0][1] * A[1][2]) / det
    tz = (A[0][0] * A[1][2] - A[1][0] * A[0][2]) / det
    return tx, tz

def baked_of(yaw, tx, tz, wx, wz):
    c, s = math.cos(yaw), math.sin(yaw)
    dx, dz = wx - tx, wz - tz
    return dx * c + dz * s, -dx * s + dz * c

# furniture centers cm
furn = {
    "chair56": (-668, 46, -370),
    "table17": (-603, 16, -330),
    "table": (-6, 24, -167),
    "shelf": (-794, 85, -336),
    "chair64": (-7, 50, -70),
}
cam = (-162, 0, -235)
look = (-0.91, -0.357, 0.213)
ll = math.sqrt(sum(v * v for v in look))
look = tuple(v / ll for v in look)

candidates = []
for pa in planes:
    yaw = wrap(ang(green_n[0], green_n[1]) - ang(pa[1], pa[2]))
    for pb in planes:
        if pb[0] == pa[0]:
            continue
        # rotate pb normal
        c, s = math.cos(yaw), math.sin(yaw)
        rn = (pb[1] * c - pb[2] * s, pb[1] * s + pb[2] * c)
        # compare to plusX
        dot = rn[0] * plus_n[0] + rn[1] * plus_n[1]
        if dot < 0.9:
            continue
        T = solve_T(yaw, green_n, green_d, pa[3], plus_n, plus_d, pb[3])
        if not T:
            continue
        # where is the dining cluster
        tx, tz = T
        def world_of(x, y, z):
            c, s = math.cos(yaw), math.sin(yaw)
            return x * c - z * s + tx, y - 139, x * s + z * c + tz
        wx, wy, wz = world_of(*furn["chair56"])
        dx, dy, dz = wx - cam[0], wy - cam[1], wz - cam[2]
        along = dx * look[0] + dy * look[1] + dz * look[2]
        side = math.sqrt(max(0, dx * dx + dy * dy + dz * dz - along * along))
        candidates.append((abs(along) + side, along, side, pa[0], pb[0], yaw * 180 / math.pi, tx, tz))

candidates.sort()
print("top pairs that map a mesh to the green wall and another to world +X")
for row in candidates[:12]:
    print(f"  cost={row[0]:6.0f} along={row[1]:6.0f} side={row[2]:5.0f} green={row[3]:16} plus={row[4]:16} yaw={row[5]:6.1f} T=({row[6]:.0f},{row[7]:.0f})")
print("count", len(candidates))
