import math

cam = (-161.81, 0, -234.79)
look = (-0.91, -0.357, 0.213)
ln = math.sqrt(sum(v * v for v in look))
look = tuple(v / ln for v in look)

# meters from the mesh survey, converted to cm centers
objs = {
    "chair56": (-668, 46, -370),
    "chair58": (-541, 46, -374),
    "chair59": (-538, 4, -377),
    "table17": (-603, 16, -330),
    "table": (-6, 24, -167),
    "shelf": (-794, 85, -336),
    "wardrobe": (-795, 86, -337),
    "window2": (-356, 108, -652),
    "wall13": (-821, 108, -228),
    "floor": (-286, 0, -230),
}

def place(yaw_deg, ux, uz, ty=-139):
    yaw = math.radians(yaw_deg)
    c, s = math.cos(yaw), math.sin(yaw)
    tx = ux * c - uz * s
    tz = ux * s + uz * c
    print(f"\n=== yaw {yaw_deg:.1f} T=({tx:.0f},{ty:.0f},{tz:.0f}) ux={ux:.0f} uz={uz:.0f}")
    for name, (x, y, z) in objs.items():
        wx = x * c - z * s + tx
        wy = y + ty
        wz = x * s + z * c + tz
        dx, dy, dz = wx - cam[0], wy - cam[1], wz - cam[2]
        along = dx * look[0] + dy * look[1] + dz * look[2]
        side = math.sqrt(max(0, dx * dx + dy * dy + dz * dz - along * along))
        print(f"  {name:10} world=({wx:7.0f},{wy:6.0f},{wz:7.0f}) along={along:6.0f} side={side:5.0f}")

# recover ux, uz from shift and yaw
yaw = math.radians(137.1)
c, s = math.cos(yaw), math.sin(yaw)
tx, tz = -363, -307
# T = R * U => U = R^T * T
ux = tx * c + tz * s
uz = -tx * s + tz * c
print("recovered", ux, uz)
place(137.1, ux, uz)

# 47.4 deg: green wall is baked +X. Try window2 x=-351 and wall13 x=-811
# green hits around (-400, -80, -210), n=(0.68, 0.73)
# Ux = q.x - coord, q = R^T * world
def rtp(yaw_deg, wx, wz):
    yaw = math.radians(yaw_deg)
    c, s = math.cos(yaw), math.sin(yaw)
    return wx * c + wz * s, -wx * s + wz * c

for yaw_deg, label in ((47.4, "plusX"), (137.1, "minusZ"), (-42.6, "plusZ"), (47.4 - 180, "minusX")):
    print("\n-- candidate", label, yaw_deg)
    # a green hit
    qx, qz = rtp(yaw_deg, -400, -210)
    print("  green baked", round(qx), round(qz))
    # +X wall hit
    qx2, qz2 = rtp(yaw_deg, -561, -110)
    print("  plusX baked", round(qx2), round(qz2))
