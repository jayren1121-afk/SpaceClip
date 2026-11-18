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
    # sample up to 400 verts
    step = max(1, n // 400)
    pts = []
    for v in range(0, n, step):
        x, y, z = struct.unpack_from("<fff", data, base + v * 48)
        nx, ny, nz = struct.unpack_from("<fff", data, base + v * 48 + 12)
        if abs(x) > 40 or abs(y) > 40 or abs(z) > 40:
            return None
        pts.append((x, y, z, nx, ny, nz))
    return pts

files = {}
for dp, _, names in os.walk(ROOT):
    for fn in names:
        if fn.endswith(".mesh"):
            files[fn] = os.path.join(dp, fn)

print("tall meshes and dominant horizontal normal")
for fn, path in sorted(files.items()):
    pts = load(path)
    if not pts:
        continue
    ys = [p[1] for p in pts]
    xs = [p[0] for p in pts]
    zs = [p[2] for p in pts]
    sy = (max(ys) - min(ys)) * 100
    if sy < 150:
        continue
    # average of normals that are mostly horizontal
    sx = sy = 0
    sz = 0
    c = 0
    for p in pts:
        if abs(p[4]) < 0.45:
            sx += p[3]
            sy += p[4]
            sz += p[5]
            c += 1
    if c < 5:
        continue
    length = math.sqrt(sx * sx + sz * sz) or 1
    print(
        f"{fn:16} horizN=({sx/length:5.2f},{sz/length:5.2f}) "
        f"x={min(xs)*100:7.0f}..{max(xs)*100:7.0f} z={min(zs)*100:7.0f}..{max(zs)*100:7.0f}"
    )
