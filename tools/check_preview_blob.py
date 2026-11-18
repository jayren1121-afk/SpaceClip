import base64
import re
import struct

path = r"C:\Users\JayTai\Documents\SpaceClip\SpaceClip\Assets\Scripts\PreviewRoomData.ts"
text = open(path, encoding="utf-8").read()
b64 = "".join(re.findall(r'"([A-Za-z0-9+/=]+)"', text))
raw = base64.b64decode(b64)
ver, count = struct.unpack_from("<HH", raw)
print("ver", ver, "count", count, "bytes", len(raw), "b64", len(b64))
offset = 4
bright = 0
dim = 0
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
    if flags & 1:
        dim += 1
    else:
        bright += 1
    if i < 2 or i == count - 1:
        print(i, "flags", flags, "min", mn, "max", mx, "always", na, "sil", ns)
print("end", offset, "of", len(raw), "brightObjs", bright, "dimObjs", dim)
