import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"

def find(name):
    for dirpath, _, files in os.walk(ROOT):
        if name in files:
            return os.path.join(dirpath, name)

def analyze(name):
    data = open(find(name), "rb").read()
    vlen, voff = 91584, 0
    # read key 17
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    ilen, ioff = struct.unpack_from("<II", head, j + 6)
    base = len(data) - (max(voff + vlen, ioff + ilen))
    print("\n==", name, "base", base, "vlen", vlen, "stride48", vlen % 48, "n48", vlen // 48)
    blob = data[base + voff:base + voff + 96]
    print("first96", blob.hex())
    # try strides
    for stride in (12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64):
        if vlen % stride:
            continue
        xs = []
        for v in range(0, min(vlen, stride * 8), stride):
            x, y, z = struct.unpack_from("<fff", data, base + voff + v)
            xs.append((round(x, 3), round(y, 3), round(z, 3)))
        print(f"  stride {stride} first {xs[:4]}")

for name in ["chair59.mesh", "wall13.mesh", "floor.mesh", "table.mesh", "shelf.mesh"]:
    analyze(name)

# attribute table: print floats/ints between 72 and 920 for chair59
data = open(find("chair59.mesh"), "rb").read()
print("\nmeta 72-400")
print(data[72:400].hex())
