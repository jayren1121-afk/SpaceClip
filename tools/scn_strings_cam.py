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

for idx in range(1, 50):
    print(f"{idx:4} {strings[idx][:90]}")
print("--- camera-like ---")
for idx, s in enumerate(strings):
    low = s.lower()
    if "camera" in low or "spawn" in low or s in ("SceneObject", "parent", "children", "components"):
        print(idx, s[:100])

# hex around the schema hit
j = 97586
print("hex", data[j - 40:j + 80].hex())
