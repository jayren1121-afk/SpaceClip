import struct

path = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home\scene.scn"
data = open(path, "rb").read()
count = struct.unpack_from("<I", data, 72)[0]
i = 76
strings = []
for n in range(count):
    ln = struct.unpack_from("<I", data, i)[0]
    i += 4
    strings.append(data[i:i + ln].decode("utf-8", "replace"))
    i += ln
bin_start = i
print("bin", bin_start, "file", len(data))

def find_u32(val, limit=12):
    needle = struct.pack("<I", val)
    hits = []
    pos = bin_start
    while len(hits) < limit:
        j = data.find(needle, pos)
        if j < 0:
            break
        hits.append(j)
        pos = j + 1
    return hits

# 0-indexed indices
wanted = {
    "SceneObject": strings.index("SceneObject"),
    "position": strings.index("position"),
    "sceneobjects": strings.index("sceneobjects"),
    "rootWS": strings.index("rootWS"),
    "Lighting": strings.index("Lighting"),
    "Light": strings.index("Light"),
    "children": strings.index("children"),
}
for name, idx in wanted.items():
    hits = find_u32(idx, 6)
    print(name, "idx", idx, "hits", len(hits), hits[:6])

# Dump around sceneobjects
idx = wanted["sceneobjects"]
j = find_u32(idx, 3)[0]
print("sceneobjects context", data[j - 16:j + 80].hex())

idx = wanted["rootWS"]
hits = find_u32(idx, 3)
if hits:
    j = hits[0]
    print("rootWS context", data[j - 16:j + 64].hex())
