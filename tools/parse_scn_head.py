import struct

path = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home\scene.scn"
data = open(path, "rb").read()
print("len", len(data))
for off in range(0, 96, 4):
    print(off, struct.unpack_from("<I", data, off)[0])

# string table often starts after a count
count = struct.unpack_from("<I", data, 72)[0]
print("count@72", count)
i = 76
names = []
for n in range(min(count, 30)):
    if i + 4 > len(data):
        break
    ln = struct.unpack_from("<I", data, i)[0]
    i += 4
    if ln > 200 or i + ln > len(data):
        print("bad len", ln, "at", i)
        break
    names.append(data[i:i + ln].decode("utf-8", "replace"))
    i += ln
print("after", i)
print("\n".join(names[:30]))
