import os
import struct

path = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home\scene.scn"
data = open(path, "rb").read()
text = data.decode("latin1")


def records(start, end):
    out = []
    i = start
    while i + 10 <= end:
        typ, key, flags, size = struct.unpack_from("<HHHI", data, i)
        if typ > 64 or size > 400 or flags > 8:
            i += 1
            continue
        if i + 10 + size > len(data):
            break
        out.append((i, typ, key, size))
        i += 10 + size
    return out


names = []
pos = 0
while True:
    j = text.find(".mesh", pos)
    if j < 0:
        break
    a = text.rfind("\x00", 0, j)
    name = text[a + 1:j + 5]
    if "/" in name or "\\" in name or len(name) > 40:
        name = name.split("/")[-1].split("\\")[-1]
    names.append((j, name))
    pos = j + 5

print("mesh refs", len(names))
shown = 0
for j, name in names:
    recs = records(max(0, j - 600), min(len(data), j + 200))
    posv = rot = scl = None
    for off, typ, key, size in recs:
        if key == 628 and size == 12 and typ == 8:
            posv = struct.unpack_from("<3f", data, off + 10)
        elif key == 629 and size == 16 and typ == 12:
            rot = struct.unpack_from("<4f", data, off + 10)
        elif key == 630 and size == 12 and typ == 8:
            scl = struct.unpack_from("<3f", data, off + 10)
    if posv and (abs(posv[0]) + abs(posv[1]) + abs(posv[2])) > 0.05:
        shown += 1
        if shown <= 40:
            pr = tuple(round(v, 2) for v in posv)
            rr = tuple(round(v, 2) for v in rot) if rot else None
            print(f"{name:22} pos {pr} rot {rr}")
print("nonzero", shown)
