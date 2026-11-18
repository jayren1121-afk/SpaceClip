/**
 * SpaceClipMiniatureController — life-size chunk editor.
 * The class name stays so the existing scene script keeps its attachment.
 * It does not build a miniature, shrink, spin, or lift a chunk off the surface.
 *
 * Owns highlight, selection, grab, sparkles, and undo for the one wireframe.
 * Hover lights one box part. A click selects that part in yellow-orange.
 * Delete bursts the selection, or the whole wire when nothing is selected.
 * A pinch-hold still moves the whole wireframe.
 *
 * @input grabbedChunk — yellow-orange lines while a chunk is selected.
 * @input sparkRoot — parent for the pale sparkle burst.
 */

import {PointerSample} from "./SpaceClipInput"
import {SpaceClipScanController} from "./SpaceClipScanController"
import {SavedSpace, SpaceSnapshot, StoredCell, WireCell, runtimeFrom, storedFrom} from "./SpaceClipTypes"
import {addWireStroke, beginMesh, buildBoxMesh, finishMesh} from "./SpaceClipMeshFactory"

const HIGHLIGHT_MAT = requireAsset("../Materials/SpaceClipHighlight.mat") as Material
const GRAB_MAT = requireAsset("../Materials/SpaceClipGrab.mat") as Material
const SPARK_MAT = requireAsset("../Materials/SpaceClipSparkle.mat") as Material

const HIGHLIGHT_COLOR = new vec4(0.85, 0.97, 1, 1)
const SELECT_COLOR = new vec4(1, 0.702, 0, 1)
const SELECT_GLOW = new vec4(1, 0.55, 0.08, 0.45)
const SPARK_COLOR = new vec4(1, 0.96, 0.84, 1)
const WIRE_GLOW_WIDTH = 1.55
const WIRE_CORE_WIDTH = 0.32

interface Spark {
  obj: SceneObject
  vel: vec3
}

@component
export class SpaceClipMiniatureController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SpaceClipMiniatureController – life-size chunks</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Object that holds the yellow-orange lines of the selected chunk.")
  grabbedChunk: SceneObject

  @input
  @hint("Parent for the pale sparkle burst.")
  sparkRoot: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Lines within this many centimeters of the cursor highlight as one chunk.")
  @widget(new SliderWidget(12, 45, 1))
  highlightRadiusCm: number = 30

  @input("vec4", "{0.85, 0.97, 1, 1}")
  @hint("Brighter cyan highlight. Kept light for an additive display.")
  @widget(new ColorWidget())
  highlightColor: vec4 = new vec4(0.85, 0.97, 1, 1)

  @input("vec4", "{1, 0.702, 0, 1}")
  @hint("Bright yellow-orange while a chunk is selected.")
  @widget(new ColorWidget())
  grabColor: vec4 = new vec4(1, 0.702, 0, 1)
  @ui.group_end

  private highlightMat: Material
  private selectMat: Material
  private selectGlowMat: Material
  private sparkMat: Material
  private highlightObj: SceneObject
  private highlightVisual: RenderMeshVisual
  private selectVisual: RenderMeshVisual
  private selectGlowVisual: RenderMeshVisual
  private selectGlowObj: SceneObject
  private removed: WireCell[][] = []
  private selected: WireCell[] = []
  private hover: WireCell[] = []
  private visualId = ""
  private highlighted = 0
  private loggedEmpty = false
  private sparks: Spark[] = []
  private sparkMesh: RenderMesh | null = null
  private sparkLife = 0
  private grabbing = false
  private grabPoint: vec3 = vec3.zero()
  private grabMoved = 0
  private grabPlanePoint: vec3 = vec3.zero()
  private grabPlaneNormal: vec3 = new vec3(0, 0, 1)
  private beforeGrab: WireCell[] = []
  private pressActive = false
  private pressPart: WireCell[] = []
  private pressPoint: vec3 = vec3.zero()
  private pressTime = 0

  onAwake(): void {
    this.highlightColor = HIGHLIGHT_COLOR
    this.grabColor = SELECT_COLOR
    this.highlightMat = this.prepMat(HIGHLIGHT_MAT, this.highlightColor)
    this.selectGlowMat = this.prepMat(GRAB_MAT, SELECT_GLOW)
    this.selectMat = this.prepMat(GRAB_MAT, this.grabColor)
    this.sparkMat = this.prepMat(SPARK_MAT, SPARK_COLOR)

    const parent = this.sparkRoot ? this.sparkRoot.getParent() : this.sceneObject
    this.highlightObj = global.scene.createSceneObject("WireHighlight")
    this.highlightObj.setParent(parent)
    const highlightTr = this.highlightObj.getTransform()
    highlightTr.setLocalPosition(vec3.zero())
    highlightTr.setLocalRotation(quat.quatIdentity())
    highlightTr.setLocalScale(new vec3(1, 1, 1))
    this.highlightVisual = this.highlightObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.highlightVisual.mainMaterial = this.highlightMat
    this.highlightVisual.renderOrder = 60
    this.highlightObj.enabled = false

    if (this.grabbedChunk) {
      this.selectVisual = this.grabbedChunk.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (!this.selectVisual) {
        this.selectVisual = this.grabbedChunk.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      }
      this.selectVisual.mainMaterial = this.selectMat
      this.selectVisual.renderOrder = 70
      this.grabbedChunk.enabled = false
      const tr = this.grabbedChunk.getTransform()
      tr.setWorldPosition(vec3.zero())
      tr.setWorldRotation(quat.quatIdentity())
      tr.setWorldScale(new vec3(1, 1, 1))
      this.selectGlowObj = global.scene.createSceneObject("WireSelectGlow")
      this.selectGlowObj.setParent(this.grabbedChunk)
      const glowTr = this.selectGlowObj.getTransform()
      glowTr.setLocalPosition(vec3.zero())
      glowTr.setLocalRotation(quat.quatIdentity())
      glowTr.setLocalScale(new vec3(1, 1, 1))
      this.selectGlowVisual = this.selectGlowObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      this.selectGlowVisual.mainMaterial = this.selectGlowMat
      this.selectGlowVisual.renderOrder = 66
    }
    if (this.sparkRoot) {
      this.sparkRoot.enabled = false
    }
  }

  tick(scan: SpaceClipScanController, sample: PointerSample, dt: number): void {
    if (scan.isForming() || sample.onUi) {
      if (sample.pinchUp) {
        this.endGrab()
      }
      this.pressActive = false
      this.hover = []
    } else if (this.grabbing && sample.pinching) {
      this.dragGrab(scan, sample)
    } else {
      if (sample.pinchUp) {
        if (this.grabbing) {
          this.endGrab()
        } else if (this.pressActive) {
          this.commitClick()
        }
        this.pressActive = false
      }
      const hits = this.selectChunk(scan, sample)
      this.hover = this.grabbing ? [] : hits
      if (!this.grabbing && sample.pinchDown) {
        this.pressActive = true
        this.pressPart = hits.slice()
        this.pressTime = getTime()
        const point = this.pointerOnWire(sample, hits)
        this.pressPoint = point ? point : hits.length > 0 ? hits[0].position : vec3.zero()
      } else if (this.pressActive && sample.pinching && this.pressPart.length > 0) {
        const now = this.pointerOnWire(sample, this.pressPart)
        const moved = now ? now.sub(this.pressPoint).length : 0
        if (moved > 6 || getTime() - this.pressTime > 0.28) {
          this.beginGrab(scan, sample)
          this.pressActive = false
          this.hover = []
        }
      }
    }
    this.redraw(scan, this.grabbing)
    this.tickSparkles(dt)
  }

  /** Part name under the pointer, or "empty" when the ray misses every line. */
  pieceUnder(scan: SpaceClipScanController, sample: PointerSample): string {
    const hits = this.selectChunk(scan, sample)
    if (hits.length === 0) {
      return "empty"
    }
    const id = hits[0].objectId && hits[0].objectId > 0 ? hits[0].objectId : 0
    return scan.partLabel(id)
  }

  hasSelection(): boolean {
    return this.selected.length > 0
  }

  selectedCells(): WireCell[] {
    return this.selected
  }

  /** Put a pre-change copy on the undo stack. */
  remember(cells: WireCell[]): void {
    const copy = this.cloneWire(cells)
    if (copy.length > 0) {
      this.removed.push(copy)
    }
  }

  /** Draw the lines again after a scale moved them. */
  refreshLines(scan: SpaceClipScanController): void {
    this.visualId = ""
    this.redraw(scan, true)
  }

  /** Object id of the blue part. -1 when nothing is selected. */
  selectedPartId(): number {
    if (this.selected.length === 0) {
      return -1
    }
    return this.selected[0].objectId && this.selected[0].objectId > 0 ? this.selected[0].objectId : 0
  }

  getSelectedCount(): number {
    return this.selected.length
  }

  getHighlightedCount(): number {
    return this.highlighted
  }

  getUndoCount(): number {
    return this.removed.length
  }

  undo(scan: SpaceClipScanController): void {
    if (this.removed.length === 0) {
      return
    }
    const chunk = this.removed.pop()
    if (!chunk) {
      return
    }
    scan.insert(chunk)
    print("[SpaceClip] undo cells=" + chunk.length + " stack=" + this.removed.length)
  }

  /** The selected chunk only. Empty when nothing is selected. */
  selectedSnapshot(): SpaceSnapshot {
    const cells: StoredCell[] = []
    for (let i = 0; i < this.selected.length; i++) {
      cells.push(storedFrom(this.selected[i]))
    }
    return {cells: cells, removed: []}
  }

  /** Add a saved chunk back onto the surfaces. Does not clear the rest. */
  restoreChunk(scan: SpaceClipScanController, space: SavedSpace): void {
    const cells: WireCell[] = []
    const source = space.cells || []
    for (let i = 0; i < source.length; i++) {
      cells.push(runtimeFrom(source[i]))
    }
    if (cells.length > 0) {
      scan.insert(cells)
    }
  }

  clearSelection(scan: SpaceClipScanController): void {
    this.selected = []
    this.hover = []
    this.visualId = ""
    this.redraw(scan, false)
  }

  /** Drop the selection, hover, and undo entries for one object. The wire is already gone. */
  clearOwner(scan: SpaceClipScanController, owner: string): void {
    const owned = (cells: WireCell[]): boolean => cells.length > 0 && cells[0].owner === owner
    let changed = false
    if (owned(this.selected) || owned(this.hover)) {
      if (owned(this.selected)) {
        this.selected = []
      }
      if (owned(this.hover)) {
        this.hover = []
      }
      this.visualId = ""
      changed = true
    }
    if (owned(this.pressPart)) {
      this.pressPart = []
      this.pressActive = false
    }
    const kept: WireCell[][] = []
    for (let i = 0; i < this.removed.length; i++) {
      const chunk: WireCell[] = []
      for (let j = 0; j < this.removed[i].length; j++) {
        if (this.removed[i][j].owner !== owner) {
          chunk.push(this.removed[i][j])
        }
      }
      if (chunk.length > 0) {
        kept.push(chunk)
      }
    }
    this.removed = kept
    if (changed) {
      this.redraw(scan, true)
    }
  }

  resetUndo(): void {
    this.removed = []
  }

  /** A short click selects the part under the cursor. Clicking it again clears. */
  private commitClick(): void {
    if (this.pressPart.length === 0) {
      this.selected = []
      print("[SpaceClip] select none")
      return
    }
    const id = this.pressPart[0].objectId
    if (this.selected.length > 0 && this.selected[0].objectId === id && id && id > 0) {
      this.selected = []
      print("[SpaceClip] select none")
      return
    }
    this.selected = this.pressPart.slice()
    print("[SpaceClip] select part=" + (id ? id : 0) + " edges=" + this.selected.length)
  }

  private pointerOnWire(sample: PointerSample, cells: WireCell[]): vec3 | null {
    if (cells.length === 0) {
      return null
    }
    if (sample.hasPoint && !sample.hasRay) {
      return sample.world
    }
    if (!sample.hasRay || sample.direction.length < 0.001) {
      return null
    }
    const dir = sample.direction.normalize()
    let best: vec3 | null = null
    let bestT = 1e9
    for (let i = 0; i < cells.length; i++) {
      const hit = closestOnRay(sample.origin, dir, cells[i].endA, cells[i].endB)
      if (hit === null) {
        continue
      }
      if (hit.t < bestT) {
        bestT = hit.t
        best = hit.point
      }
    }
    return best
  }

  /** Sparkle the whole wireframe and remember it for Undo. */
  deleteAll(scan: SpaceClipScanController): void {
    const live = scan.getCells()
    if (live.length === 0) {
      return
    }
    this.selected = live.slice()
    this.deleteSelected(scan)
  }

  deleteSelected(scan: SpaceClipScanController): void {
    if (this.selected.length === 0) {
      return
    }
    const keys: string[] = []
    for (let i = 0; i < this.selected.length; i++) {
      keys.push(this.selected[i].key)
    }
    const chunk = scan.extract(keys)
    scan.block(keys)
    if (chunk.length > 0) {
      this.removed.push(chunk)
      this.burst(centroidOf(chunk))
    }
    this.selected = []
    this.hover = []
    this.visualId = ""
    this.redraw(scan, false)
    print("[SpaceClip] delete cells=" + chunk.length + " undo=" + this.removed.length)
  }

  private beginGrab(scan: SpaceClipScanController, sample: PointerSample): void {
    const pivot = this.wireCenter(scan)
    this.grabbing = true
    this.grabMoved = 0
    this.beforeGrab = this.cloneWire(scan.getCells())
    this.grabPlanePoint = pivot
    const normal = pivot.sub(sample.origin)
    this.grabPlaneNormal = normal.length > 1 ? normal.normalize() : new vec3(0, 0, 1)
    const point = this.hitGrabPlane(sample)
    this.grabPoint = point ? point : pivot
    print("[SpaceClip] grab")
  }

  private dragGrab(scan: SpaceClipScanController, sample: PointerSample): void {
    const point = this.hitGrabPlane(sample)
    if (point === null) {
      return
    }
    const delta = point.sub(this.grabPoint)
    this.grabMoved += delta.length
    this.grabPoint = point
    scan.translate(delta)
  }

  private endGrab(): void {
    if (!this.grabbing) {
      return
    }
    this.grabbing = false
    if (this.grabMoved > 2 && this.beforeGrab.length > 0) {
      this.removed.push(this.beforeGrab)
      print("[SpaceClip] placed move=" + this.grabMoved.toFixed(0))
    }
    this.beforeGrab = []
  }

  private hitGrabPlane(sample: PointerSample): vec3 | null {
    if (sample.hasPoint && !sample.hasRay) {
      return sample.world
    }
    if (!sample.hasRay) {
      return null
    }
    const denom = sample.direction.dot(this.grabPlaneNormal)
    if (Math.abs(denom) < 0.0001) {
      return null
    }
    const t = this.grabPlanePoint.sub(sample.origin).dot(this.grabPlaneNormal) / denom
    if (t < 8 || t > 800) {
      return null
    }
    return sample.origin.add(sample.direction.uniformScale(t))
  }

  private wireCenter(scan: SpaceClipScanController): vec3 {
    const cells = scan.getCells()
    let sum = vec3.zero()
    for (let i = 0; i < cells.length; i++) {
      sum = sum.add(cells[i].position)
    }
    if (cells.length === 0) {
      return vec3.zero()
    }
    return sum.uniformScale(1 / cells.length)
  }

  private cloneWire(cells: WireCell[]): WireCell[] {
    const out: WireCell[] = []
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      out.push({
        key: cell.key,
        position: cell.position,
        normal: cell.normal,
        endA: cell.endA,
        endB: cell.endB,
        dim: cell.dim,
        objectId: cell.objectId,
        owner: cell.owner,
      })
    }
    return out
  }

  private selectChunk(scan: SpaceClipScanController, sample: PointerSample): WireCell[] {
    const cells = scan.getCells()
    if (cells.length === 0) {
      return []
    }
    const radius = this.highlightRadiusCm
    if (sample.hasPoint) {
      const nearest = nearestWithin(cells, sample.world, radius)
      if (nearest === null) {
        return []
      }
      return chunkOf(cells, nearest, sample.world, radius)
    }
    if (!sample.hasRay || sample.direction.length < 0.001) {
      return []
    }
    const origin = sample.origin
    const dir = sample.direction.normalize()
    let bestT = 1e9
    let bestPoint: vec3 | null = null
    let bestCell: WireCell | null = null
    for (let i = 0; i < cells.length; i++) {
      const hit = closestOnRay(origin, dir, cells[i].endA, cells[i].endB)
      if (hit === null || hit.dist > 18) {
        continue
      }
      if (hit.t < bestT) {
        bestT = hit.t
        bestPoint = hit.point
        bestCell = cells[i]
      }
    }
    if (bestPoint === null || bestCell === null) {
      return []
    }
    return chunkOf(cells, bestCell, bestPoint, radius)
  }

  private burst(worldPos: vec3): void {
    this.ensureSparks()
    this.sparkRoot.enabled = true
    this.sparkLife = 0.7
    this.sparkMat.mainPass.baseColor = SPARK_COLOR
    for (let i = 0; i < this.sparks.length; i++) {
      const yaw = (i / this.sparks.length) * Math.PI * 2
      const lift = ((i % 5) - 2) * 0.35
      const dir = new vec3(Math.cos(yaw), 0.55 + lift, Math.sin(yaw)).normalize()
      this.sparks[i].vel = dir.uniformScale(28 + (i % 4) * 8)
      this.sparks[i].obj.enabled = true
      this.sparks[i].obj.getTransform().setWorldPosition(worldPos)
      this.sparks[i].obj.getTransform().setWorldRotation(quat.quatIdentity())
      this.sparks[i].obj.getTransform().setLocalScale(new vec3(1, 1, 1))
    }
    print("[SpaceClip] sparkles")
  }

  private ensureSparks(): void {
    if (this.sparks.length > 0 || !this.sparkRoot) {
      return
    }
    this.sparkMesh = buildBoxMesh(1.8, 1.8, 1.8)
    for (let i = 0; i < 16; i++) {
      const obj = global.scene.createSceneObject("Sparkle")
      obj.setParent(this.sparkRoot)
      const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      visual.mesh = this.sparkMesh
      visual.mainMaterial = this.sparkMat
      visual.renderOrder = 80
      this.sparks.push({obj: obj, vel: vec3.zero()})
    }
  }

  private tickSparkles(dt: number): void {
    if (this.sparkLife <= 0) {
      return
    }
    this.sparkLife -= dt
    const u = Math.max(0, this.sparkLife / 0.7)
    this.sparkMat.mainPass.baseColor = new vec4(SPARK_COLOR.x, SPARK_COLOR.y, SPARK_COLOR.z, u)
    const scale = Math.max(0.2, u)
    for (let i = 0; i < this.sparks.length; i++) {
      const tr = this.sparks[i].obj.getTransform()
      tr.setWorldPosition(tr.getWorldPosition().add(this.sparks[i].vel.uniformScale(dt)))
      tr.setLocalScale(new vec3(scale, scale, scale))
    }
    if (this.sparkLife <= 0 && this.sparkRoot) {
      this.sparkRoot.enabled = false
    }
  }

  private redraw(scan: SpaceClipScanController, force: boolean): void {
    this.highlighted = this.hover.length
    const selectedKeys: {[key: string]: boolean} = {}
    for (let i = 0; i < this.selected.length; i++) {
      selectedKeys[this.selected[i].key] = true
    }
    const hoverDraw: WireCell[] = []
    for (let i = 0; i < this.hover.length; i++) {
      if (!selectedKeys[this.hover[i].key]) {
        hoverDraw.push(this.hover[i])
      }
    }
    const id = keysOf(hoverDraw) + "#" + keysOf(this.selected)
    if (!force && id === this.visualId) {
      return
    }
    this.visualId = id
    const omit: string[] = []
    for (let i = 0; i < hoverDraw.length; i++) {
      omit.push(hoverDraw[i].key)
    }
    for (let i = 0; i < this.selected.length; i++) {
      omit.push(this.selected[i].key)
    }
    scan.setOmit(omit)
    this.drawHoverMesh(hoverDraw)
    this.drawSelectionMesh()
  }

  private drawHoverMesh(hits: WireCell[]): void {
    if (hits.length === 0) {
      this.highlightObj.enabled = false
      return
    }
    const draft = beginMesh()
    for (let i = 0; i < hits.length; i++) {
      addWireStroke(draft, hits[i].endA, hits[i].endB, hits[i].normal)
    }
    this.highlightObj.enabled = finishMesh(draft, this.highlightVisual)
  }

  private drawSelectionMesh(): void {
    if (!this.grabbedChunk || !this.selectVisual || !this.selectGlowVisual) {
      return
    }
    if (this.selected.length === 0) {
      this.grabbedChunk.enabled = false
      return
    }
    const tr = this.grabbedChunk.getTransform()
    tr.setWorldPosition(vec3.zero())
    tr.setWorldRotation(quat.quatIdentity())
    tr.setWorldScale(new vec3(1, 1, 1))
    const glow = beginMesh()
    const core = beginMesh()
    for (let i = 0; i < this.selected.length; i++) {
      addWireStroke(glow, this.selected[i].endA, this.selected[i].endB, this.selected[i].normal, WIRE_GLOW_WIDTH)
      addWireStroke(core, this.selected[i].endA, this.selected[i].endB, this.selected[i].normal, WIRE_CORE_WIDTH)
    }
    const glowOn = finishMesh(glow, this.selectGlowVisual)
    const coreOn = finishMesh(core, this.selectVisual)
    this.grabbedChunk.enabled = glowOn || coreOn
  }

  private prepMat(source: Material, color: vec4): Material {
    const mat = source.clone()
    mat.mainPass.blendMode = BlendMode.Normal
    mat.mainPass.twoSided = true
    mat.mainPass.depthWrite = false
    mat.mainPass.baseColor = color
    return mat
  }
}

/** Edges of one box share an object id, so a hover takes one leg, the seat, or the back. */
function chunkOf(cells: WireCell[], seed: WireCell, point: vec3, radius: number): WireCell[] {
  const id = seed.objectId
  if (id && id > 0) {
    const group: WireCell[] = []
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].objectId === id) {
        group.push(cells[i])
      }
    }
    return group
  }
  return nearPoint(cells, point, radius)
}

function nearestWithin(cells: WireCell[], point: vec3, radius: number): WireCell | null {
  let best: WireCell | null = null
  let bestDist = radius
  for (let i = 0; i < cells.length; i++) {
    const dist = distToSegment(point, cells[i].endA, cells[i].endB)
    if (dist <= bestDist) {
      bestDist = dist
      best = cells[i]
    }
  }
  return best
}

function nearPoint(cells: WireCell[], point: vec3, radius: number): WireCell[] {
  const hits: WireCell[] = []
  for (let i = 0; i < cells.length; i++) {
    if (distToSegment(point, cells[i].endA, cells[i].endB) <= radius) {
      hits.push(cells[i])
    }
  }
  return hits
}

function distToSegment(point: vec3, a: vec3, b: vec3): number {
  const ab = b.sub(a)
  const len2 = ab.dot(ab)
  if (len2 < 0.01) {
    return point.sub(a).length
  }
  let t = point.sub(a).dot(ab) / len2
  if (t < 0) {
    t = 0
  } else if (t > 1) {
    t = 1
  }
  return point.sub(a.add(ab.uniformScale(t))).length
}

/** Closest point on a segment to a ray. `dir` must be a unit vector. */
function closestOnRay(origin: vec3, dir: vec3, a: vec3, b: vec3): {t: number; dist: number; point: vec3} | null {
  const v = b.sub(a)
  const w = origin.sub(a)
  const bDot = dir.dot(v)
  const c = v.dot(v)
  const d = dir.dot(w)
  const e = v.dot(w)
  const denom = c - bDot * bDot
  let segT = 0
  if (c < 0.01) {
    segT = 0
  } else if (denom < 0.01) {
    segT = e / c
  } else {
    segT = (e - bDot * d) / denom
  }
  if (segT < 0) {
    segT = 0
  } else if (segT > 1) {
    segT = 1
  }
  const point = a.add(v.uniformScale(segT))
  const t = point.sub(origin).dot(dir)
  if (t < 15) {
    return null
  }
  return {t: t, dist: point.sub(origin.add(dir.uniformScale(t))).length, point: point}
}

function centroidOf(cells: WireCell[]): vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < cells.length; i++) {
    x += cells[i].position.x
    y += cells[i].position.y
    z += cells[i].position.z
  }
  const n = Math.max(1, cells.length)
  return new vec3(x / n, y / n, z / n)
}

function keysOf(cells: WireCell[]): string {
  const parts: string[] = []
  for (let i = 0; i < cells.length; i++) {
    parts.push(cells[i].key)
  }
  parts.sort()
  return parts.join("|")
}
