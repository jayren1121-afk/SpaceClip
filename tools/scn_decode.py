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

def name(key):
    if 0 <= key < len(strings):
        return strings[key][:40]
    return str(key)

# Format: u16 type, u32 key, u32 size, payload.
# type 0 consumes 2 bytes and ends an object.
pos = i
records = 0
interesting = []
while pos + 2 <= len(data) and records < 400:
    typ = struct.unpack_from("<H", data, pos)[0]
    if typ == 0:
        interesting.append((pos, "END"))
        pos += 2
        records += 1
        continue
    if pos + 10 > len(data):
        print("short", pos)
        break
    key, size = struct.unpack_from("<II", data, pos + 2)
    if size > 200000 or pos + 10 + size > len(data) or key > len(strings) + 5:
        print("bad", pos, "typ", typ, "key", key, name(key) if key < len(strings) else "", "size", size)
        print(data[pos:pos + 32].hex())
        break
    payload = data[pos + 10:pos + 10 + size]
    label = name(key)
    extra = ""
    if size == 12 and typ in (8, 16):
        extra = str(tuple(round(v, 3) for v in struct.unpack("<3f", payload)))
    elif size == 16 and typ in (12, 16):
        extra = str(tuple(round(v, 3) for v in struct.unpack("<4f", payload)))
    elif size == 4:
        v = struct.unpack("<I", payload)[0]
        extra = str(v)
        if v < len(strings):
            extra += ":" + strings[v][:30]
    if typ >= 14 or size not in (0, 1, 4, 8, 12, 16, 64) or label in ("position", "rotation", "scale", "SceneObject", "sceneobjects"):
        interesting.append((pos, typ, label, size, extra[:60]))
    pos += 10 + size
    records += 1

print("records", records, "pos", pos, "remain", len(data) - pos)
for row in interesting[:80]:
    print(row)
