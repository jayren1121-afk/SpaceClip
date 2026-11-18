import struct

path = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home\scene.scn"
data = open(path, "rb").read()
text = data.decode("latin1")
# find shelf mesh path and dump following structured values by scanning for type 8 size 12
idx = text.find("shelf.mesh")
print("shelf ref", idx)
# scan whole file for type=8, size=12 records that land on plausible floats
found = 0
for i in range(0, len(data) - 22):
    typ, key, flags, size = struct.unpack_from("<HHHI", data, i)
    if typ == 8 and flags == 0 and size == 12:
        x, y, z = struct.unpack_from("<fff", data, i + 10)
        if max(abs(x), abs(y), abs(z)) < 40 and (abs(x) > 0.2 or abs(z) > 0.2):
            found += 1
            if found <= 30:
                print(i, "key", key, round(x, 2), round(y, 2), round(z, 2))
print("found", found)
