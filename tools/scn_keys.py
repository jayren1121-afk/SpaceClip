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
for idx in range(610, 720):
    if idx < len(strings):
        print(f"{idx:4} {strings[idx][:80]}")
print("total", len(strings) - 1)
