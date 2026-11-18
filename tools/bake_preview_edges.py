"""Bake Colorful Home sharp edges for the editor Clip fallback.

Reads the Lens Studio interactive scene meshes and writes
Assets/Scripts/PreviewRoomData.ts. World units in the bake are centimeters.
"""

import base64
import math
import os
import struct

ROOT = r"C:\Program Files\Snap Inc\Lens Studio\InteractiveResources.bundle\Scenes\Colorful Home"
OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "Assets", "Scripts", "PreviewRoomData.ts")

COS_SHARP = math.cos(math.radians(30.0))
COS_SOFT = math.cos(math.radians(18.0))
MIN_LEN_M = 0.03
MAX_ALWAYS = 420
MAX_SIL = 100


def load_mesh(path):
    data = open(path, "rb").read()
    head = data[:4096]
    i = head.find(struct.pack("<HHH", 0x0F, 17, 0))
    j = head.find(struct.pack("<HHH", 0x0F, 18, 0))
    if i < 0 or j < 0:
        return None
    vlen, voff = struct.unpack_from("<II", head, i + 6)
    ilen, ioff = struct.unpack_from("<II", head, j + 6)
    if vlen < 48 or ilen < 6 or vlen % 48 != 0 or ilen % 2 != 0:
        return None
    end = max(voff + vlen, ioff + ilen)
    base = len(data) - end
    if base < 0:
        return None
    count = vlen // 48
    pos = [struct.unpack_from("<fff", data, base + v * 48) for v in range(count)]
    idx = struct.unpack_from("<" + "H" * (ilen // 2), data, base + ioff)
    return pos, idx


def bake_one(path, name):
    loaded = load_mesh(path)
    if loaded is None:
        return None
    pos, idx = loaded
    weld = {}
    verts = []

    def key(p):
        return (round(p[0] * 200.0), round(p[1] * 200.0), round(p[2] * 200.0))

    for p in pos:
        k = key(p)
        if k not in weld:
            weld[k] = len(verts)
            verts.append(p)
    remap = [weld[key(p)] for p in pos]
    faces = []
    for t in range(0, len(idx) - 2, 3):
        a, b, c = remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]
        if a == b or b == c or a == c:
            continue
        faces.append((a, b, c))
    if len(faces) < 1:
        return None
    edges = {}

    def ek(a, b):
        return (a, b) if a < b else (b, a)

    for fi, (a, b, c) in enumerate(faces):
        for e in (ek(a, b), ek(b, c), ek(c, a)):
            edges.setdefault(e, []).append(fi)

    def nrm(fi):
        a, b, c = faces[fi]
        ax, ay, az = verts[a]
        bx, by, bz = verts[b]
        cx, cy, cz = verts[c]
        nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
        ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
        nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        return (nx / length, ny / length, nz / length)

    always = []
    sil = []
    xs = [p[0] for p in verts]
    ys = [p[1] for p in verts]
    zs = [p[2] for p in verts]
    for (a, b), fs in edges.items():
        ax, ay, az = verts[a]
        bx, by, bz = verts[b]
        dx, dy, dz = bx - ax, by - ay, bz - az
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length < MIN_LEN_M:
            continue
        if len(fs) == 1:
            always.append((length, ax, ay, az, bx, by, bz))
            continue
        n1 = nrm(fs[0])
        n2 = nrm(fs[1])
        dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
        if dot > 1:
            dot = 1
        elif dot < -1:
            dot = -1
        if dot < COS_SHARP:
            always.append((length, ax, ay, az, bx, by, bz))
        elif dot < COS_SOFT:
            sil.append((length, ax, ay, az, bx, by, bz, n1, n2))
    if not always and not sil:
        return None
    always.sort(key=lambda e: e[0], reverse=True)
    sil.sort(key=lambda e: e[0], reverse=True)
    always = always[:MAX_ALWAYS]
    sil = sil[:MAX_SIL]
    low = name.lower()
    dim = any(token in low for token in ("wall", "floor", "ceiling", "rug", "cornice"))
    dx = (max(xs) - min(xs)) * 100.0
    dy = (max(ys) - min(ys)) * 100.0
    dz = (max(zs) - min(zs)) * 100.0
    diag = math.sqrt(dx * dx + dy * dy + dz * dz)
    large = dim or diag > 260.0
    return {
        "name": name,
        "dim": dim,
        "large": large,
        "min": (min(xs) * 100.0, min(ys) * 100.0, min(zs) * 100.0),
        "max": (max(xs) * 100.0, max(ys) * 100.0, max(zs) * 100.0),
        "always": always,
        "sil": sil,
    }


def q(v):
    n = int(round(v))
    if n > 32767:
        return 32767
    if n < -32768:
        return -32768
    return n


def qn(v):
    n = int(round(v * 127.0))
    if n > 127:
        return 127
    if n < -128:
        return -128
    return n


def pack(objects):
    blob = bytearray()
    blob += struct.pack("<HH", 1, len(objects))
    for obj in objects:
        flags = (1 if obj["dim"] else 0) | (2 if obj["large"] else 0)
        mn = obj["min"]
        mx = obj["max"]
        blob += struct.pack(
            "<B6hHH",
            flags,
            q(mn[0]),
            q(mn[1]),
            q(mn[2]),
            q(mx[0]),
            q(mx[1]),
            q(mx[2]),
            len(obj["always"]),
            len(obj["sil"]),
        )
        for edge in obj["always"]:
            blob += struct.pack("<6h", q(edge[1] * 100), q(edge[2] * 100), q(edge[3] * 100), q(edge[4] * 100), q(edge[5] * 100), q(edge[6] * 100))
        for edge in obj["sil"]:
            n1, n2 = edge[7], edge[8]
            blob += struct.pack(
                "<6h6b",
                q(edge[1] * 100),
                q(edge[2] * 100),
                q(edge[3] * 100),
                q(edge[4] * 100),
                q(edge[5] * 100),
                q(edge[6] * 100),
                qn(n1[0]),
                qn(n1[1]),
                qn(n1[2]),
                qn(n2[0]),
                qn(n2[1]),
                qn(n2[2]),
            )
    return bytes(blob)


def main():
    objects = []
    for dirpath, _, names in os.walk(ROOT):
        for name in names:
            if not name.endswith(".mesh"):
                continue
            baked = bake_one(os.path.join(dirpath, name), name[: -len(".mesh")])
            if baked is None:
                continue
            objects.append(baked)
    objects.sort(key=lambda obj: (obj["dim"], obj["name"]))
    raw = pack(objects)
    text = base64.b64encode(raw).decode("ascii")
    lines = [
        "/**",
        " * Baked Colorful Home edges for the editor Clip fallback.",
        " * Sharp creases (face angle above 30 degrees) plus a softer band",
        " * used only for silhouette edges. Generated by tools/bake_preview_edges.py.",
        " */",
        "export const PREVIEW_ROOM_PARTS: string[] = [",
    ]
    for i in range(0, len(text), 120):
        lines.append('  "' + text[i : i + 120] + '",')
    lines.append("]")
    lines.append("")
    open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    always = sum(len(obj["always"]) for obj in objects)
    sil = sum(len(obj["sil"]) for obj in objects)
    print("objects", len(objects), "always", always, "sil", sil, "bytes", len(raw), "file", OUT)


if __name__ == "__main__":
    main()
