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
    if vlen < 48 or vlen % 48 or ilen < 6 or ilen % 2:
        return None
    end = max(voff + vlen, ioff + ilen)
    base = len(data) - end
    if base < 64:
        return None
    n = vlen // 48
    pos = []
    nrm = []
    for v in range(n):
        o = base + voff + v * 48
        pos.append(struct.unpack_from("<fff", data, o))
        nrm.append(struct.unpack_from("<fff", data, o + 12))
    idx = struct.unpack_from("<" + "H" * (ilen // 2), data, base + ioff)
    return pos, nrm, idx

def bbox(pos):
    mn = [min(p[k] for p in pos) for k in range(3)]
    mx = [max(p[k] for p in pos) for k in range(3)]
    return mn, mx

def avg_normal(nrm):
    s = [0, 0, 0]
    for n in nrm:
        for k in range(3):
            s[k] += n[k]
    length = math.sqrt(sum(v * v for v in s)) or 1
    return tuple(v / length for v in s)

files = {}
for dirpath, _, names in os.walk(ROOT):
    for fn in names:
        if fn.endswith(".mesh"):
            files[fn] = os.path.join(dirpath, fn)

want = [
    "floor.mesh", "wall13.mesh", "wall1.mesh", "window2.mesh", "shelf.mesh",
    "table.mesh", "table17.mesh", "chair59.mesh", "chair56.mesh", "chair58.mesh",
    "chair64.mesh", "chair65.mesh", "werdrobe.mesh",
]
for fn in want:
    loaded = load(files[fn])
    if not loaded:
        print(fn, "FAIL")
        continue
    pos, nrm, idx = loaded
    mn, mx = bbox(pos)
    size = [mx[k] - mn[k] for k in range(3)]
    n = avg_normal(nrm)
    print(
        f"{fn:16} n={len(pos):5} "
        f"min=({mn[0]:7.2f},{mn[1]:6.2f},{mn[2]:7.2f}) "
        f"size=({size[0]:5.2f},{size[1]:5.2f},{size[2]:5.2f}) "
        f"N=({n[0]:5.2f},{n[1]:5.2f},{n[2]:5.2f})"
    )
