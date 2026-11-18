/**
 * Editor Clip fallback. Colorful Home mesh edges baked in centimeters.
 * On device Clip keeps using the World Mesh and never reads this.
 */

import {PREVIEW_ROOM_PARTS} from "./PreviewRoomData"

export interface BakedObject {
  id: number
  dim: boolean
  /** Floor and walls are clipped to the view instead of drawn whole. */
  large: boolean
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  /** xyzxyz centimeters, 6 values per sharp or boundary edge. */
  always: Int16Array
  /** xyzxyz centimeters, 6 values per softer edge. */
  silPos: Int16Array
  /** Two unit normals, 6 values per silhouette edge, scaled by 127. */
  silN: Int8Array
}

let cached: BakedObject[] | null = null
let heightColumns: {[key: string]: number[]} | null = null

export function bakedRoom(): BakedObject[] {
  if (cached !== null) {
    return cached
  }
  cached = decodeRoom(PREVIEW_ROOM_PARTS.join(""))
  return cached
}

/**
 * Depth hits are in preview tracking space. Colorful Home meshes use another origin.
 * The dining bookcase, table, and chairs share one translation: the floor drops to
 * the up-facing hits, and the bookcase shelf board lands on the higher up-facing hits.
 */
export function previewRoomShift(xs: number[], ys: number[], zs: number[]): vec3 {
  if (ys.length === 0) {
    return new vec3(193, -136, 148)
  }
  let low = ys[0]
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] < low) {
      low = ys[i]
    }
  }
  let floorY = 0
  let floors = 0
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] < low + 14) {
      floorY += ys[i]
      floors++
    }
  }
  const floor = floorY / floors
  let boardX = 0
  let boardZ = 0
  let boards = 0
  for (let i = 0; i < ys.length; i++) {
    const above = ys[i] - floor
    if (above > 45 && above < 75) {
      boardX += xs[i]
      boardZ += zs[i]
      boards++
    }
  }
  if (boards === 0) {
    return new vec3(193, floor, 148)
  }
  // shelf.mesh board at baked (-795, 56, -208) centimeters.
  return new vec3(boardX / boards + 795, floor, boardZ / boards + 208)
}

function searchShift(
  xs: number[],
  ys: number[],
  zs: number[],
  x0: number,
  x1: number,
  xStep: number,
  y0: number,
  y1: number,
  yStep: number,
  originX: number,
  originY: number,
  originZ: number
): vec3 {
  let bestX = originX
  let bestY = originY
  let bestZ = originZ
  let bestScore = -1
  for (let x = originX + x0; x <= originX + x1; x += xStep) {
    for (let z = originZ + x0; z <= originZ + x1; z += xStep) {
      for (let y = originY + y0; y <= originY + y1; y += yStep) {
        let score = 0
        for (let i = 0; i < xs.length; i++) {
          if (columnMatches(xs[i] - x, zs[i] - z, ys[i] - y)) {
            score++
          }
        }
        if (score > bestScore) {
          bestScore = score
          bestX = x
          bestY = y
          bestZ = z
        }
      }
    }
  }
  return new vec3(bestX, bestY, bestZ)
}

function columnMatches(x: number, z: number, bakedY: number): boolean {
  const ix = Math.round(x / 30)
  const iz = Math.round(z / 30)
  const columns = heightColumns
  if (columns === null) {
    return false
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = columns[ix + dx + "," + (iz + dz)]
      if (!list) {
        continue
      }
      for (let i = 0; i < list.length; i++) {
        if (Math.abs(list[i] - bakedY) < 14) {
          return true
        }
      }
    }
  }
  return false
}

function ensureColumns(): void {
  if (heightColumns !== null) {
    return
  }
  const columns: {[key: string]: number[]} = {}
  const room = bakedRoom()
  for (let i = 0; i < room.length; i++) {
    if (room[i].dim || room[i].large) {
      continue
    }
    const edges = room[i].always
    for (let e = 0; e < edges.length; e += 6) {
      const x = (edges[e] + edges[e + 3]) * 0.5
      const y = (edges[e + 1] + edges[e + 4]) * 0.5
      const z = (edges[e + 2] + edges[e + 5]) * 0.5
      const key = Math.round(x / 30) + "," + Math.round(z / 30)
      let list = columns[key]
      if (!list) {
        list = []
        columns[key] = list
      }
      let known = false
      for (let s = 0; s < list.length; s++) {
        if (Math.abs(list[s] - y) < 8) {
          known = true
          break
        }
      }
      if (!known && list.length < 16) {
        list.push(y)
      }
    }
  }
  heightColumns = columns
}

function decodeRoom(text: string): BakedObject[] {
  const bytes = decodeB64(text)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const version = view.getUint16(offset, true)
  offset += 2
  const count = view.getUint16(offset, true)
  offset += 2
  if (version !== 1 || count < 1) {
    return []
  }
  const objects: BakedObject[] = []
  for (let i = 0; i < count && offset + 17 <= bytes.length; i++) {
    const flags = view.getUint8(offset)
    offset += 1
    const minX = view.getInt16(offset, true)
    offset += 2
    const minY = view.getInt16(offset, true)
    offset += 2
    const minZ = view.getInt16(offset, true)
    offset += 2
    const maxX = view.getInt16(offset, true)
    offset += 2
    const maxY = view.getInt16(offset, true)
    offset += 2
    const maxZ = view.getInt16(offset, true)
    offset += 2
    const nAlways = view.getUint16(offset, true)
    offset += 2
    const nSil = view.getUint16(offset, true)
    offset += 2
    const always = new Int16Array(nAlways * 6)
    for (let e = 0; e < always.length && offset + 2 <= bytes.length; e++) {
      always[e] = view.getInt16(offset, true)
      offset += 2
    }
    const silPos = new Int16Array(nSil * 6)
    const silN = new Int8Array(nSil * 6)
    for (let e = 0; e < nSil && offset + 18 <= bytes.length; e++) {
      for (let k = 0; k < 6; k++) {
        silPos[e * 6 + k] = view.getInt16(offset, true)
        offset += 2
      }
      for (let k = 0; k < 6; k++) {
        silN[e * 6 + k] = view.getInt8(offset)
        offset += 1
      }
    }
    objects.push({
      id: i + 1,
      dim: (flags & 1) !== 0,
      large: (flags & 2) !== 0,
      minX: minX,
      minY: minY,
      minZ: minZ,
      maxX: maxX,
      maxY: maxY,
      maxZ: maxZ,
      always: always,
      silPos: silPos,
      silN: silN,
    })
  }
  return objects
}

function decodeB64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const len = text.length
  let pad = 0
  if (len > 0 && text.charAt(len - 1) === "=") {
    pad++
  }
  if (len > 1 && text.charAt(len - 2) === "=") {
    pad++
  }
  const out = new Uint8Array(Math.max(0, Math.floor((len * 3) / 4) - pad))
  let written = 0
  for (let i = 0; i + 3 < len; i += 4) {
    const a = alphabet.indexOf(text.charAt(i))
    const b = alphabet.indexOf(text.charAt(i + 1))
    const c = alphabet.indexOf(text.charAt(i + 2))
    const d = alphabet.indexOf(text.charAt(i + 3))
    const bits = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d)
    if (written < out.length) {
      out[written++] = (bits >> 16) & 255
    }
    if (written < out.length) {
      out[written++] = (bits >> 8) & 255
    }
    if (written < out.length) {
      out[written++] = bits & 255
    }
  }
  return out
}
