import base64
import re
import struct

path = r"C:\Users\JayTai\Documents\SpaceClip\SpaceClip\Assets\Scripts\PreviewRoomData.ts"
text = open(path, encoding="utf-8").read()
raw = base64.b64decode("".join(re.findall(r'"([A-Za-z0-9+/=]+)"', text)))
_, count = struct.unpack_from("<HH", raw)
offset = 4
hits = []
for i in range(count):
    flags = raw[offset]
    offset += 1
    mn = struct.unpack_from("<3h", raw, offset)
    offset += 6
    mx = struct.unpack_from("<3h", raw, offset)
    offset += 6
    na, ns = struct.unpack_from("<HH", raw, offset)
    offset += 4
    offset += na * 12 + ns * 18
    # distance from point (-564, 0, -141) to bbox in xz
    x, z = -564, -141
    cx = min(max(x, mn[0]), mx[0])
    cz = min(max(z, mn[2]), mx[2])
    dist = ((cx - x) ** 2 + (cz - z) ** 2) ** 0.5
    hits.append((dist, i, flags, mn, mx, na))
hits.sort()
for row in hits[:12]:
    print(row)
