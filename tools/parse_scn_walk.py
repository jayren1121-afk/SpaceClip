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
print("data start", i)

def show(i, label):
    typ, key, flags, size = struct.unpack_from("<HHHI", data, i)
    name = strings[key] if key < len(strings) else "?"
    print(label, "off", i, "typ", typ, "key", key, name[:40], "flags", flags, "size", size)
    print(data[i:i + 40].hex())

n = 0
while n < 40 and i + 10 <= len(data):
    typ, key, flags, size = struct.unpack_from("<HHHI", data, i)
    name = strings[key] if 0 < key < len(strings) else "?"
    ok = size < 50000 and i + 10 + size <= len(data) and typ < 80
    print(f"{n:03} off {i} t{typ} k{key} {name[:28]!r} f{flags} sz{size} ok={ok}")
    if not ok:
        print(data[i:i + 48].hex())
        break
    i += 10 + size
    n += 1
print("stopped", i)
