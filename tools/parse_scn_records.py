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

records = []
while i + 10 <= len(data):
    typ, key, flags, size = struct.unpack_from("<HHHI", data, i)
    if size > 100000 or i + 10 + size > len(data):
        print("break", i, typ, key, flags, size)
        break
    payload = data[i + 10:i + 10 + size]
    records.append((i, typ, key, flags, size, payload))
    i += 10 + size
print("records", len(records), "end", i, "remain", len(data) - i)

def s(key):
    if 0 <= key < len(strings):
        return strings[key]
    return "?"

# show a window of records around first position
for n, rec in enumerate(records):
    if rec[2] == 627:
        print("--- pos at record", n)
        for rec2 in records[max(0, n - 8):n + 12]:
            off, typ, key, flags, size, payload = rec2
            extra = ""
            if size == 4 and typ in (2, 6, 7):
                v = struct.unpack_from("<I", payload)[0]
                extra = f" u32={v}"
                if 0 < v < len(strings) and typ in (6, 7):
                    extra += " str=" + strings[v][:60]
            elif size == 12 and typ == 8:
                extra = " vec=" + str(tuple(round(x, 3) for x in struct.unpack_from("<3f", payload)))
            elif size == 16 and typ == 12:
                extra = " quat=" + str(tuple(round(x, 3) for x in struct.unpack_from("<4f", payload)))
            elif size == 1:
                extra = " b=" + str(payload[0])
            print(f"  t{typ} k{key}({s(key)[:24]}) f{flags} sz{size}{extra}")
        break

print("name key count", sum(1 for r in records if r[2] == 19))
print("position count", sum(1 for r in records if r[2] == 627))
print("children count", sum(1 for r in records if r[2] == 632))
print("types", sorted(set(r[1] for r in records)))
