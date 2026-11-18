import struct

path = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home\scene.scn"
data = open(path, "rb").read()
hits = 0
for i in range(0, len(data) - 12, 4):
    x, y, z = struct.unpack_from("<fff", data, i)
    if not all(abs(v) < 30 and abs(v) > 0.05 for v in (x, y, z)):
        continue
    if abs(y) > 8:
        continue
    hits += 1
    if hits <= 25:
        print(i, round(x, 3), round(y, 3), round(z, 3))
print("hits", hits)
