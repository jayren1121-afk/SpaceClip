import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"
wanted = ["chair59.mesh", "wall13.mesh", "floor.mesh", "table.mesh", "shelf.mesh", "chair64.mesh"]

def find(name):
    for dirpath, _, files in os.walk(ROOT):
        if name in files:
            return os.path.join(dirpath, name)
    return None

for name in wanted:
    path = find(name)
    data = open(path, "rb").read()
    head = data[:512]
    print("\n==", name, "len", len(data))
    print("head", data[:80].hex())
    # find all type 0x0f records in first 4096
    i = 0
    shown = 0
    while i < 4096 and shown < 12:
        if i + 14 <= 4096 and struct.unpack_from("<H", data, i)[0] == 0x0F:
            typ, key, flags, length, offset = struct.unpack_from("<HHHII", data, i)
            if length < 50_000_000 and offset < len(data):
                print(f"  off {i} key {key} flags {flags} len {length} dataOff {offset}")
                shown += 1
                i += 14
                continue
        i += 1
