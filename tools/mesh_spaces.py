import math
import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"

def load_bounds(path):
    data = open(path, "rb").read()
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    if i < 0 or j < 0:
        return None
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    if vlen < 48 or vlen % 48 != 0:
        return None
    end = voff + vlen
    base = len(data) - end
    if base < 0:
        return None
    count = vlen // 48
    mn = [1e9, 1e9, 1e9]
    mx = [-1e9, -1e9, -1e9]
    for v in range(count):
        x, y, z = struct.unpack_from("<fff", data, base + v * 48)
        mn[0] = min(mn[0], x); mn[1] = min(mn[1], y); mn[2] = min(mn[2], z)
        mx[0] = max(mx[0], x); mx[1] = max(mx[1], y); mx[2] = max(mx[2], z)
    return mn, mx, count

rows = []
for dirpath, _, files in os.walk(ROOT):
    for fn in files:
        if not fn.endswith(".mesh"):
            continue
        bounds = load_bounds(os.path.join(dirpath, fn))
        if not bounds:
            continue
        mn, mx, count = bounds
        size = [mx[k] - mn[k] for k in range(3)]
        center = [(mn[k] + mx[k]) * 0.5 for k in range(3)]
        rows.append((fn, center, size, count))

print("meshes", len(rows))
# classify local-at-origin vs room space
local = []
room = []
for fn, c, s, n in rows:
    span = max(s)
    dist = math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
    if dist < 2 and span < 3:
        local.append((fn, c, s))
    else:
        room.append((fn, c, s))
print("local-ish", len(local), "room-ish", len(room))
print("--- room centers (m) ---")
for fn, c, s in sorted(room, key=lambda r: r[1][0])[:40]:
    print(f"{fn:22} c=({c[0]:7.2f},{c[1]:6.2f},{c[2]:7.2f}) s=({s[0]:5.2f},{s[1]:5.2f},{s[2]:5.2f})")
print("--- local ---")
for fn, c, s in local:
    print(f"{fn:22} c=({c[0]:7.2f},{c[1]:6.2f},{c[2]:7.2f}) s=({s[0]:5.2f},{s[1]:5.2f},{s[2]:5.2f})")
