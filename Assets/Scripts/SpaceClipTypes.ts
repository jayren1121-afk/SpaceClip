/**
 * Shared value types for SpaceClip.
 * Owns the life-size wire cell and the saved-space snapshot. No scene access.
 */

export interface WireCell {
  key: string
  /** Midpoint. Hover and selection measure against the whole segment. */
  position: vec3
  normal: vec3
  endA: vec3
  endB: vec3
  /** Flat wall or floor. Drawn faint so furniture stays bright. */
  dim?: boolean
  /** Preview mesh this edge belongs to. A whole chair or the table. */
  objectId?: number
  /** Demo root this edge belongs to, such as DemoShelf. One wire per owner. */
  owner?: string
}

/** Plain numbers so a snapshot survives PersistentStorage JSON. */
export interface StoredCell {
  key: string
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  dim?: number
  objectId?: number
}

export interface SpaceSnapshot {
  cells: StoredCell[]
  removed: StoredCell[][]
}

export interface SavedSpace extends SpaceSnapshot {
  name: string
  date: string
}

export function storedFrom(cell: WireCell): StoredCell {
  return {
    key: cell.key,
    x: cell.position.x,
    y: cell.position.y,
    z: cell.position.z,
    nx: cell.normal.x,
    ny: cell.normal.y,
    nz: cell.normal.z,
    ax: cell.endA.x,
    ay: cell.endA.y,
    az: cell.endA.z,
    bx: cell.endB.x,
    by: cell.endB.y,
    bz: cell.endB.z,
    dim: cell.dim ? 1 : 0,
    objectId: cell.objectId && cell.objectId > 0 ? cell.objectId : 0,
  }
}

export function runtimeFrom(cell: StoredCell): WireCell {
  const position = new vec3(cell.x || 0, cell.y || 0, cell.z || 0)
  const normal = new vec3(cell.nx || 0, cell.ny || 1, cell.nz || 0)
  const hasEnds = cell.ax !== undefined && cell.bx !== undefined
  let endA: vec3
  let endB: vec3
  if (hasEnds) {
    endA = new vec3(cell.ax || 0, cell.ay || 0, cell.az || 0)
    endB = new vec3(cell.bx || 0, cell.by || 0, cell.bz || 0)
  } else {
    const n = normal.length > 0.001 ? normal.normalize() : vec3.up()
    const helper = Math.abs(n.y) < 0.9 ? vec3.up() : vec3.right()
    const along = helper.cross(n).normalize().uniformScale(4)
    endA = position.sub(along)
    endB = position.add(along)
  }
  return {
    key: cell.key || "",
    position: position,
    normal: normal,
    endA: endA,
    endB: endB,
    dim: cell.dim === 1,
    objectId: cell.objectId && cell.objectId > 0 ? cell.objectId : undefined,
  }
}

export function copyStored(cell: StoredCell): StoredCell {
  return {
    key: cell.key || "",
    x: cell.x || 0,
    y: cell.y || 0,
    z: cell.z || 0,
    nx: cell.nx || 0,
    ny: cell.ny === undefined ? 1 : cell.ny,
    nz: cell.nz || 0,
    ax: cell.ax === undefined ? cell.x || 0 : cell.ax,
    ay: cell.ay === undefined ? cell.y || 0 : cell.ay,
    az: cell.az === undefined ? cell.z || 0 : cell.az,
    bx: cell.bx === undefined ? cell.x || 0 : cell.bx,
    by: cell.by === undefined ? cell.y || 0 : cell.by,
    bz: cell.bz === undefined ? cell.z || 0 : cell.bz,
    dim: cell.dim === 1 ? 1 : 0,
    objectId: cell.objectId && cell.objectId > 0 ? cell.objectId : 0,
  }
}

export function todayLabel(): string {
  const date = new Date()
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return months[date.getMonth()] + " " + date.getDate()
}
