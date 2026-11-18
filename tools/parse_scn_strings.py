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
print("strings", len(strings), "end", i, "remain", len(data) - i)
print("next64", data[i:i + 64].hex())
# print strings that look like scene object names
interesting = []
for idx, s in enumerate(strings):
    if s.endswith(".mesh") or "SceneObject" in s or s in ("Camera", "parent", "children", "localTransform", "position", "rotation", "scale"):
        interesting.append((idx, s[:80]))
print("interesting", len(interesting))
for row in interesting[:60]:
    print(row)
print("--- keys ---")
for idx, s in enumerate(strings):
    if s.lower() in ("position", "rotation", "scale", "parent", "children", "name", "enabled", "layer", "localposition", "worldposition"):
        print(idx, s)
