import struct

path = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home\scene.scn"
data = open(path, "rb").read()
count = struct.unpack_from("<I", data, 72)[0]
i = 76
strings = [""]
for n in range(count):
    ln = struct.unpack_from("<I", data, i)[0]
    i += 4
    strings.append(data[i:i + ln].decode("utf-8", "replace"))
    i += ln
start = i
print("bin", start)
needle = struct.pack("<H", 627)
hits = []
pos = start
while True:
    j = data.find(needle, pos)
    if j < 0 or j > len(data) - 20:
        break
    hits.append(j)
    pos = j + 1
print("key627 hits", len(hits))
for j in hits[:8]:
    window = data[j - 6:j + 28]
    print("at", j, window.hex())
    # try type immediately before key
    if j >= 2:
        typ = struct.unpack_from("<H", data, j - 2)[0]
        print("  typBefore", typ)
    # if layout is typ,key,flags,size and this is key
    if j >= 2 and j + 8 <= len(data):
        typ, key, flags, size = struct.unpack_from("<HHHI", data, j - 2)
        print("  as record", typ, key, flags, size)

print("--- string index of SceneObject / RenderMesh ---")
for idx, s in enumerate(strings):
    if "SceneObject" in s or "RenderMesh" in s or s in ("components", "parent", "mesh", "localTransform"):
        print(idx, s)
