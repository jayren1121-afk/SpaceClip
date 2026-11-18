/**
 * Code-authored meshes for the wireframe, voxels, and sparkles.
 * Builds MeshBuilder geometry in centimeters. Does not load GLBs.
 */

const LAYOUT = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true},
  {name: "texture0", components: 2},
]

export interface MeshDraft {
  builder: MeshBuilder
  indices: number[]
  base: number
}

export function beginMesh(): MeshDraft {
  const builder = new MeshBuilder(LAYOUT)
  builder.topology = MeshTopology.Triangles
  builder.indexType = MeshIndexType.UInt16
  return {builder: builder, indices: [], base: 0}
}

export function finishMesh(draft: MeshDraft, visual: RenderMeshVisual): boolean {
  if (draft.base <= 0 || draft.indices.length === 0) {
    return false
  }
  draft.builder.appendIndices(draft.indices)
  if (!draft.builder.isValid()) {
    return false
  }
  visual.mesh = draft.builder.getMesh()
  draft.builder.updateMesh()
  return true
}

export function buildBoxMesh(sizeX: number, sizeY: number, sizeZ: number): RenderMesh {
  const draft = beginMesh()
  addBox(draft, 0, 0, 0, sizeX * 0.5, sizeY * 0.5, sizeZ * 0.5)
  draft.builder.appendIndices(draft.indices)
  const mesh = draft.builder.getMesh()
  draft.builder.updateMesh()
  return mesh
}

function pushVert(verts: number[], p: vec3, n: vec3): void {
  verts.push(p.x, p.y, p.z, n.x, n.y, n.z, 0, 0)
}

/** One CCW quad. `axisU × axisV` is flipped to match `normal`. */
export function addPlaneQuad(
  draft: MeshDraft,
  center: vec3,
  normal: vec3,
  axisU: vec3,
  axisV: vec3,
  halfU: number,
  halfV: number
): void {
  const n = normal.normalize()
  const u = axisU.normalize()
  let v = axisV.normalize()
  if (u.cross(v).dot(n) < 0) {
    v = v.uniformScale(-1)
  }
  const p0 = center.sub(u.uniformScale(halfU)).sub(v.uniformScale(halfV))
  const p1 = center.add(u.uniformScale(halfU)).sub(v.uniformScale(halfV))
  const p2 = center.add(u.uniformScale(halfU)).add(v.uniformScale(halfV))
  const p3 = center.sub(u.uniformScale(halfU)).add(v.uniformScale(halfV))
  const verts: number[] = []
  pushVert(verts, p0, n)
  pushVert(verts, p1, n)
  pushVert(verts, p2, n)
  pushVert(verts, p3, n)
  const b = draft.base
  draft.indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
  draft.builder.appendVerticesInterleaved(verts)
  draft.base = b + 4
}

export function addEdge(draft: MeshDraft, a: vec3, b: vec3, normal: vec3, halfWidth: number): void {
  const edge = b.sub(a)
  if (edge.length < 0.01) {
    return
  }
  const mid = a.add(edge.uniformScale(0.5))
  const side = normal.cross(edge)
  if (side.length < 0.0001) {
    return
  }
  addPlaneQuad(draft, mid, normal, edge, side, edge.length * 0.5, halfWidth)
}

/**
 * One sketch stroke. A short ribbon on the surface, extended a little past
 * its ends so neighboring strokes meet as one line.
 */
export function addWireStroke(draft: MeshDraft, a: vec3, b: vec3, normal: vec3, halfWidth?: number): void {
  const edge = b.sub(a)
  const len = edge.length
  if (len < 0.4) {
    return
  }
  const width = halfWidth === undefined ? 0.38 : halfWidth
  const n = normal.length < 0.001 ? vec3.up() : normal.normalize()
  const lift = n.uniformScale(0.4)
  const extra = edge.uniformScale(Math.min(0.7, len * 0.06) / len)
  addEdge(draft, a.sub(extra).add(lift), b.add(extra).add(lift), n, width)
}

/** Glowing square outline. Kept for older callers; the sketch uses strokes. */
export function addWireCell(draft: MeshDraft, center: vec3, normal: vec3, cellSize: number): void {
  const n = normal.normalize()
  const helper = Math.abs(n.y) < 0.9 ? vec3.up() : vec3.right()
  const u = helper.cross(n).normalize()
  const v = n.cross(u).normalize()
  const half = cellSize * 0.34
  const lifted = center.add(n.uniformScale(0.6))
  const c0 = lifted.sub(u.uniformScale(half)).sub(v.uniformScale(half))
  const c1 = lifted.add(u.uniformScale(half)).sub(v.uniformScale(half))
  const c2 = lifted.add(u.uniformScale(half)).add(v.uniformScale(half))
  const c3 = lifted.sub(u.uniformScale(half)).add(v.uniformScale(half))
  const w = Math.max(0.22, Math.min(0.45, cellSize * 0.03))
  addEdge(draft, c0, c1, n, w)
  addEdge(draft, c1, c2, n, w)
  addEdge(draft, c2, c3, n, w)
  addEdge(draft, c3, c0, n, w)
}

/**
 * Closed box, 24 verts, CCW from the outside.
 * Half extents are in centimeters. Winding matches the mesh-builder box helper.
 */
export function addBox(draft: MeshDraft, cx: number, cy: number, cz: number, hw: number, hh: number, hd: number): void {
  const x0 = cx - hw
  const x1 = cx + hw
  const y0 = cy - hh
  const y1 = cy + hh
  const z0 = cz - hd
  const z1 = cz + hd
  const verts: number[] = []
  let vi = draft.base

  const face = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx2: number, cy2: number, cz2: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number
  ) => {
    const n = new vec3(nx, ny, nz)
    pushVert(verts, new vec3(ax, ay, az), n)
    pushVert(verts, new vec3(bx, by, bz), n)
    pushVert(verts, new vec3(cx2, cy2, cz2), n)
    pushVert(verts, new vec3(dx, dy, dz), n)
    draft.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
    vi += 4
  }

  face(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, 1, 0, 0)
  face(x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0, -1, 0, 0)
  face(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0)
  face(x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1, 0, -1, 0)
  face(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1)
  face(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1)

  draft.builder.appendVerticesInterleaved(verts)
  draft.base = vi
}
