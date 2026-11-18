import math
import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"

def load_pos(path):
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
    for v in range(n):
        x, y, z = struct.unpack_from("<fff", data, base + v * 48)
        if abs(x) > 50 or abs(y) > 50 or abs(z) > 50:
            return None
        mn[0] = min(mn[0], x); mn[1] = min(mn[1], y); mn[2] = min(mn[2], z)
        mx[0] = max(mx[0], x); mx[1] = max(mx[1], y); mx[2] = max(mx[2], z)
    return mn, mx

files = {}
for dp, _, names in os.walk(ROOT):
    for fn in names:
        if fn.endswith(".mesh"):
            files[fn] = os.path.join(dp, fn)

print("thin tall meshes (cm)")
for fn, path in sorted(files.items()):
    b = load_pos(path)
    if not b:
        continue
    mn, mx = b
    sx, sy, sz = [(mx[k] - mn[k]) * 100 for k in range(3)]
    if sy < 140:
        continue
    if sx < 45 and sz > 80:
        print(f"  X {fn:16} x={mn[0]*100:7.0f}..{mx[0]*100:7.0f} z={mn[2]*100:7.0f}..{mx[2]*100:7.0f} y={mn[1]*100:6.0f}..{mx[1]*100:6.0f}")
    elif sz < 45 and sx > 80:
        print(f"  Z {fn:16} z={mn[2]*100:7.0f}..{mx[2]*100:7.0f} x={mn[0]*100:7.0f}..{mx[0]*100:7.0f} y={mn[1]*100:6.0f}..{mx[1]*100:6.0f}")
