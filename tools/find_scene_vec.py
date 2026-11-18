import struct
path = r"C:\Users\JayTai\Documents\SpaceClip\SpaceClip\Assets\Scene.scene"
data = open(path, "rb").read()
print("len", len(data), "head", data[:16].hex())
# find vec3 40,85,20 and 0,65,0
needles = {
    "light": struct.pack("<fff", 40, 85, 20),
    "ambient": struct.pack("<fff", 0, 65, 0),
    "mini": struct.pack("<fff", 0, 150, -60),
}
for name, needle in needles.items():
    j = data.find(needle)
    print(name, j)
    if j >= 0:
        print(data[j - 24:j + 24].hex())
# string table?
count = struct.unpack_from("<I", data, 72)[0]
print("count72", count)
