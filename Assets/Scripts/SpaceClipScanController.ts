/**
 * SpaceClipScanController — life-size line sketch on the surfaces you look at.
 * Owns the strokes, the gaps, and the cyan line mesh. This mesh is the thing
 * you edit. It does not build a miniature and it does not scan on its own.
 *
 * On device, Clip keeps the World Mesh cluster in the middle of the view.
 * In the editor it draws the demo chair or table under the center of the view,
 * using that object's own mesh and world transform. Lines trace in from bottom to top.
 *
 * @input standInRoot — empty object that receives the fallback room.
 */

import {StoredCell, WireCell, runtimeFrom, storedFrom} from "./SpaceClipTypes"
import {addWireStroke, beginMesh, buildBoxMesh, finishMesh} from "./SpaceClipMeshFactory"
import {BakedObject, bakedRoom} from "./PreviewRoomEdges"

const WIRE_MAT = requireAsset("../Materials/SpaceClipWire.mat") as Material
const ROOM_MAT = requireAsset("../Materials/SpaceClipRoom.mat") as Material
const WORLD_MESH = requireAsset("../Meshes/SpaceClipWorldMesh.worldmesh") as RenderMesh
const WorldQuery = require("LensStudio:WorldQueryModule") as WorldQueryModule

interface RayJob {
  u: number
  v: number
  c: number
  r: number
}

interface SurfSample {
  c: number
  r: number
  hit: boolean
  position: vec3
  normal: vec3
}

const FINE_C = 32
const FINE_R = 24
const COARSE = 2
const UV0 = 0.06
const UV1 = 0.94
const PLANE_GAP = 8
const NORMAL_DOT = 0.72

@component
export class SpaceClipScanController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SpaceClipScanController – surface wireframe</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Empty object. The fallback room is built here if the preview world query never hits.")
  standInRoot: SceneObject
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("World size of one wireframe cell, in centimeters. Used to dedupe hits, not to move them off the surface.")
  @widget(new SliderWidget(10, 40, 1))
  cellSizeCm: number = 14

  @input
  @hint("Eye height used to stand the fallback room on the floor, in centimeters.")
  @widget(new SliderWidget(120, 190, 1))
  eyeHeightCm: number = 160

  @input
  @hint("Maximum sketch strokes kept from one Clip.")
  @widget(new SliderWidget(80, 2000, 10))
  maxCells: number = 1600

  @input("vec4", "{0.05, 0.78, 1, 1}")
  @hint("Light cyan wireframe color for an additive display.")
  @widget(new ColorWidget())
  wireColor: vec4 = new vec4(0.05, 0.78, 1, 1)
  @ui.group_end

  private cells = new Map<string, WireCell>()
  private blocked = new Set<string>()
  private omit = new Set<string>()
  private omitId = ""
  private source: "pending" | "world" | "standin" | "preview" = "pending"
  private worldHits = 0
  private dirty = false
  private visual: RenderMeshVisual
  private glowVisual: RenderMeshVisual
  private dimVisual: RenderMeshVisual
  private dimGlowVisual: RenderMeshVisual
  private worldMesh: RenderMesh | null = null
  private worldVisual: RenderMeshVisual | null = null
  private meshWait = false
  private previewCapture = false
  private previewProbesLeft = -1
  private previewHits: vec3[] = []
  private previewNormals: vec3[] = []
  private previewShift: vec3 = vec3.zero()
  /** Temporary. Draws every Colorful Home box so the room pose can be checked. */
  private previewDebugBoxes = false
  /** Depth point nearest the middle of the view, and the floor under it. */
  private previewAim: vec3 | null = null
  private previewAimN: vec3 = vec3.up()
  private previewAimScore = 1e9
  private previewFloor = -136
  /** Rising scan. formStart < 0 means the wire is fully drawn. */
  private formStart = -1
  private formLow = 0
  private formHigh = 1
  /** Colorful Home is yawed relative to the preview tracking frame. */
  private previewCos = 1
  private previewSin = 0
  private captureLook: vec3 = new vec3(0, 0, 1)
  private captureCamera: Camera | null = null
  private wireMat: Material
  private glowMat: Material
  private session: HitTestSession | null = null
  private probes: Probe[] = []
  private queue: RayJob[] = []
  private queueIndex = 0
  private refineQueued = false
  private refineCount = 0
  private sampleHits = 0
  private samples = new Map<string, SurfSample>()
  private issued = new Set<string>()
  private captureCam: vec3 = vec3.zero()
  /** Demo box id to a readable part name, such as leg_front_right. */
  private partNames: {[id: number]: string} = {}
  private nextPartId = 1
  /** Owner whose edges are tracing in. Other owners stay fully drawn. */
  private formingOwner = ""
  /** Demo root chosen at the start of this Clip, so the trace matches the removal. */
  private captureRoot: SceneObject | null = null
  private standInBuilt = false
  private inflight = 0
  private inflightSince = 0
  private readonly maxInFlight = 8
  private loggedHit = false
  private tracking: DeviceTracking | null = null
  private trackingLooked = false
  private meshMisses = 0
  private attempts = 0
  private callbacks = 0
  private rejected = 0
  private capturing = false
  private draining = false
  private hitsOpen = false
  private captureLeft = 0
  private raysIssued = 0
  private captureGen = 0

  onAwake(): void {
    this.maxCells = 1600
    this.wireColor = new vec4(0.05, 0.78, 1, 1)
    this.wireMat = WIRE_MAT.clone()
    this.wireMat.mainPass.blendMode = BlendMode.Normal
    this.wireMat.mainPass.twoSided = true
    this.wireMat.mainPass.depthWrite = false
    this.wireMat.mainPass.depthTest = false
    this.wireMat.mainPass.baseColor = this.wireColor

    const meshObj = global.scene.createSceneObject("WireframeMesh")
    meshObj.setParent(this.sceneObject)
    this.visual = meshObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.visual.mainMaterial = this.wireMat
    this.visual.renderOrder = 51

    this.glowMat = WIRE_MAT.clone()
    this.glowMat.mainPass.blendMode = BlendMode.Normal
    this.glowMat.mainPass.twoSided = true
    this.glowMat.mainPass.depthWrite = false
    this.glowMat.mainPass.depthTest = false
    this.glowMat.mainPass.baseColor = new vec4(0.22, 0.62, 1, 0.45)
    const glowObj = global.scene.createSceneObject("WireGlow")
    glowObj.setParent(this.sceneObject)
    this.glowVisual = glowObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.glowVisual.mainMaterial = this.glowMat
    this.glowVisual.renderOrder = 49

    const dimMat = WIRE_MAT.clone()
    dimMat.mainPass.blendMode = BlendMode.Normal
    dimMat.mainPass.twoSided = true
    dimMat.mainPass.depthWrite = false
    dimMat.mainPass.depthTest = false
    dimMat.mainPass.baseColor = new vec4(0.45, 0.75, 1, 0.22)
    const dimObj = global.scene.createSceneObject("WireDim")
    dimObj.setParent(this.sceneObject)
    this.dimVisual = dimObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.dimVisual.mainMaterial = dimMat
    this.dimVisual.renderOrder = 48
    const dimGlowMat = WIRE_MAT.clone()
    dimGlowMat.mainPass.blendMode = BlendMode.Normal
    dimGlowMat.mainPass.twoSided = true
    dimGlowMat.mainPass.depthWrite = false
    dimGlowMat.mainPass.depthTest = false
    dimGlowMat.mainPass.baseColor = new vec4(0.25, 0.5, 1, 0.08)
    const dimGlowObj = global.scene.createSceneObject("WireDimGlow")
    dimGlowObj.setParent(this.sceneObject)
    this.dimGlowVisual = dimGlowObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.dimGlowVisual.mainMaterial = dimGlowMat
    this.dimGlowVisual.renderOrder = 47

    this.attachWorldMesh()

    for (let i = 0; i < 6; i++) {
      this.probes.push(Physics.createGlobalProbe())
    }
    this.tryStartWorldQuery()
    if (this.standInRoot) {
      this.standInRoot.enabled = false
    }
  }

  cellCount(): number {
    return this.cells.size
  }

  cellSize(): number {
    return this.cellSizeCm
  }

  sourceName(): string {
    return this.source
  }

  /** True while a Clip is casting, or the one wireframe is still tracing in. */
  isCapturing(): boolean {
    return this.capturing || this.draining || this.isForming()
  }

  /** Lines trace in from bottom to top for about a second after the mesh is chosen. */
  isForming(): boolean {
    return this.formStart >= 0 && getTime() - this.formStart < 1
  }

  /** Keep the rising scan dirty until every edge is in. */
  tickForm(): void {
    if (this.isForming()) {
      this.dirty = true
    }
  }

  /**
   * Scale these recorded cells about their own center. `base` is the pose
   * before the gesture, so repeating the call does not compound.
   */
  scaleFrom(base: WireCell[], factor: number): void {
    if (base.length === 0) {
      return
    }
    let sum = vec3.zero()
    for (let i = 0; i < base.length; i++) {
      sum = sum.add(base[i].position)
    }
    const pivot = sum.uniformScale(1 / base.length)
    for (let i = 0; i < base.length; i++) {
      const src = base[i]
      const live = this.cells.get(src.key)
      if (!live) {
        continue
      }
      live.position = pivot.add(src.position.sub(pivot).uniformScale(factor))
      live.endA = pivot.add(src.endA.sub(pivot).uniformScale(factor))
      live.endB = pivot.add(src.endB.sub(pivot).uniformScale(factor))
    }
    this.dirty = true
  }

  translate(delta: vec3): void {
    if (delta.length < 0.01) {
      return
    }
    this.cells.forEach((cell) => {
      cell.position = cell.position.add(delta)
      cell.endA = cell.endA.add(delta)
      cell.endB = cell.endB.add(delta)
    })
    this.formLow += delta.y
    this.formHigh += delta.y
    this.dirty = true
  }

  /**
   * Cast the view once. A demo object that already has a wire loses that wire
   * first. Other objects stay. Returns the owner name when a wire was replaced.
   * Main must call fireRays until isCapturing() is false.
   */
  beginCapture(camera: Camera): string {
    if (this.isForming()) {
      return ""
    }
    let replaced = ""
    this.captureRoot = null
    this.captureCam = camera.getTransform().getWorldPosition()
    this.captureLook = camera.getTransform().back
    this.captureCamera = camera
    if (global.deviceInfoSystem.isEditor()) {
      let look = this.captureLook
      if (look.length < 0.001) {
        look = new vec3(0, 0, -1)
      } else {
        look = look.normalize()
      }
      const chosen = this.demoRootOnRay(this.demoRoots(), this.captureCam, look)
      this.captureRoot = chosen
      if (chosen !== null && this.removeOwner(chosen.name) > 0) {
        replaced = chosen.name
        print("[SpaceClip] reclip " + chosen.name + ", replaced old wire")
      }
    }
    this.captureGen++
    this.dirty = true
    this.loggedHit = false
    this.capturing = true
    this.draining = false
    this.hitsOpen = true
    this.previewCapture = global.deviceInfoSystem.isEditor()
    this.formStart = -1
    this.captureLeft = this.previewCapture ? 0.2 : 3.5
    this.maxCells = 12000
    this.raysIssued = 0
    this.inflight = 0
    this.samples.clear()
    this.issued.clear()
    this.meshWait = true
    if (!this.previewCapture && this.worldVisual) {
      this.worldVisual.enabled = true
    }
    this.queue = []
    this.queueIndex = 0
    this.refineQueued = false
    this.refineCount = 0
    this.sampleHits = 0
    this.rebuildIfDirty()
    return replaced
  }

  getCells(): WireCell[] {
    const list: WireCell[] = []
    this.cells.forEach((cell) => {
      list.push(cell)
    })
    return list
  }

  storedCells(): StoredCell[] {
    const list: StoredCell[] = []
    this.cells.forEach((cell) => {
      list.push(storedFrom(cell))
    })
    return list
  }

  /** Pull these cells out of the drawn wire so a grab can carry them. */
  extract(keys: string[]): WireCell[] {
    const out: WireCell[] = []
    for (let i = 0; i < keys.length; i++) {
      const cell = this.cells.get(keys[i])
      if (!cell) {
        continue
      }
      this.cells.delete(keys[i])
      out.push(cell)
    }
    if (out.length > 0) {
      this.dirty = true
    }
    return out
  }

  /** Stop later rays from filling a gap or a chunk that is in the hand. */
  block(keys: string[]): void {
    for (let i = 0; i < keys.length; i++) {
      this.blocked.add(keys[i])
    }
  }

  /** Put a chunk back on the surface. Used by undo. */
  insert(cells: WireCell[]): void {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      this.blocked.delete(cell.key)
      this.cells.set(cell.key, cell)
    }
    this.dirty = true
  }

  /** Replace the wire with a saved space. Blocked keys stay as gaps. */
  replace(cells: WireCell[], blockedKeys: string[]): void {
    this.cells.clear()
    this.blocked.clear()
    this.omit.clear()
    this.omitId = ""
    for (let i = 0; i < blockedKeys.length; i++) {
      this.blocked.add(blockedKeys[i])
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      if (this.blocked.has(cell.key)) {
        continue
      }
      this.cells.set(cell.key, cell)
    }
    this.dirty = true
  }

  /** Drop one object's wire immediately. No sparkles. Other objects stay. */
  private removeOwner(owner: string): number {
    const drop: string[] = []
    const partIds: number[] = []
    this.cells.forEach((cell, key) => {
      if (cell.owner !== owner) {
        return
      }
      drop.push(key)
      if (cell.objectId && cell.objectId > 0) {
        partIds.push(cell.objectId)
      }
    })
    for (let i = 0; i < drop.length; i++) {
      this.cells.delete(drop[i])
      this.blocked.delete(drop[i])
      this.omit.delete(drop[i])
    }
    for (let i = 0; i < partIds.length; i++) {
      delete this.partNames[partIds[i]]
    }
    if (drop.length > 0) {
      this.omitId = ""
      this.dirty = true
    }
    return drop.length
  }

  /** Cells drawn by the highlight mesh instead of the base cyan mesh. */
  setOmit(keys: string[]): void {
    const id = keys.join("|")
    if (id === this.omitId) {
      return
    }
    this.omitId = id
    this.omit.clear()
    for (let i = 0; i < keys.length; i++) {
      this.omit.add(keys[i])
    }
    this.dirty = true
  }

  /**
   * Cast the current view once. Call from Update only while isCapturing().
   * A coarse fan lands first. Extra rays fill only the quads where depth or
   * facing changes. Strokes are built when those rays have landed.
   */
  fireRays(camera: Camera, dt: number): void {
    if (!this.capturing && !this.draining) {
      return
    }
    if (!this.sceneObject.enabled) {
      return
    }
    this.captureCam = camera.getTransform().getWorldPosition()
    this.captureLook = camera.getTransform().back
    this.captureCamera = camera
    this.captureLeft -= dt
    if (this.previewCapture) {
      if (this.meshWait) {
        this.meshWait = false
        this.finishCapture()
      }
      return
    }
    if (this.meshWait) {
      const faces = this.worldFaceCount()
      const settled = faces > 30 && this.captureLeft < 2.4
      if (settled || this.captureLeft <= 0) {
        this.meshWait = false
        this.finishCapture()
      }
      return
    }
    if (this.inflight > 0 && getTime() - this.inflightSince > 0.4) {
      this.inflight = 0
    }
    const batch = 10
    const gen = this.captureGen
    for (let n = 0; n < batch && this.queueIndex < this.queue.length; n++) {
      const job = this.queue[this.queueIndex]
      if (!this.castOne(camera, job, n, gen)) {
        break
      }
      this.queueIndex++
      this.raysIssued++
    }
    const queueDone = this.queueIndex >= this.queue.length && this.inflight <= 0
    if (queueDone && !this.refineQueued) {
      this.queue = this.buildRefineJobs()
      this.queueIndex = 0
      this.refineQueued = true
      this.refineCount = this.queue.length
      print("[SpaceClip] refine rays=" + this.queue.length)
      if (this.queue.length === 0) {
        this.finishCapture()
      }
      return
    }
    if (queueDone && this.refineQueued) {
      this.finishCapture()
      return
    }
    if (this.captureLeft <= -1.5 && this.inflight <= 0) {
      print("[SpaceClip] capture timed out, using hits so far")
      this.finishCapture()
    }
  }

  /** Rebuild the wire mesh after hit callbacks and edits. Call from LateUpdate. */
  rebuildIfDirty(): void {
    if (!this.dirty) {
      return
    }
    this.dirty = false
    const glow = beginMesh()
    const core = beginMesh()
    const dimGlow = beginMesh()
    const dimCore = beginMesh()
    const forming = this.isForming()
    const limit = this.formLow + (this.formHigh - this.formLow) * (forming ? (getTime() - this.formStart) / 1 : 1)
    this.cells.forEach((cell) => {
      if (this.omit.has(cell.key)) {
        return
      }
      const clipThis = forming && (this.formingOwner === "" ? !cell.owner : cell.owner === this.formingOwner)
      const drawn = clipThis ? this.clipRising(cell.endA, cell.endB, limit) : [cell.endA, cell.endB]
      if (drawn === null) {
        return
      }
      if (cell.dim) {
        addWireStroke(dimGlow, drawn[0], drawn[1], cell.normal, 1.15)
        addWireStroke(dimCore, drawn[0], drawn[1], cell.normal, 0.22)
      } else {
        addWireStroke(glow, drawn[0], drawn[1], cell.normal, 1.55)
        addWireStroke(core, drawn[0], drawn[1], cell.normal, 0.32)
      }
    })
    this.glowVisual.enabled = finishMesh(glow, this.glowVisual)
    this.visual.enabled = finishMesh(core, this.visual)
    this.dimGlowVisual.enabled = finishMesh(dimGlow, this.dimGlowVisual)
    this.dimVisual.enabled = finishMesh(dimCore, this.dimVisual)
  }

  loadStored(cells: StoredCell[], blockedKeys: string[]): void {
    const runtime: WireCell[] = []
    for (let i = 0; i < cells.length; i++) {
      runtime.push(runtimeFrom(cells[i]))
    }
    this.replace(runtime, blockedKeys)
  }

  private tryStartWorldQuery(): void {
    try {
      const options = HitTestSessionOptions.create()
      options.filter = false
      this.session = WorldQuery.createHitTestSessionWithOptions(options)
      this.session.start()
      print("[SpaceClip] world query started")
    } catch (err) {
      print("[SpaceClip] world query unavailable, stand-in will be used. " + err)
      this.worldHits = 0
    }
  }

  /** Returns false when the ray should be retried because the query is busy. */
  private castOne(camera: Camera, job: RayJob, probeIndex: number, gen: number): boolean {
    const uv = new vec2(job.u, job.v)
    const start = camera.screenSpaceToWorldSpace(uv, 30)
    const end = camera.screenSpaceToWorldSpace(uv, 700)
    const camPos = camera.getTransform().getWorldPosition()
    const tracking = this.deviceTracking(camera)
    if (tracking) {
      try {
        const meshHits = tracking.hitTestWorldMesh(uv)
        if (meshHits && meshHits.length > 0) {
          if (gen === this.captureGen && this.hitsOpen) {
            this.noteWorld(job, meshHits[0].position, meshHits[0].normal, camPos)
          }
          return true
        }
        this.meshMisses++
        if (this.meshMisses === 30) {
          print("[SpaceClip] world mesh rays missed, depth hits still used")
        }
      } catch (err) {
        this.tracking = null
        print("[SpaceClip] world mesh unavailable. " + err)
      }
    }
    if (this.session) {
      if (this.inflight >= this.maxInFlight) {
        return false
      }
      this.inflight++
      if (this.inflight === 1) {
        this.inflightSince = getTime()
      }
      const rayStart = start
      const rayEnd = end
      this.attempts++
      this.issued.add(this.cellKey(job.c, job.r))
      this.session.hitTest(rayStart, rayEnd, (hit: WorldQueryHitTestResult) => {
        if (gen === this.captureGen) {
          this.inflight = Math.max(0, this.inflight - 1)
          this.inflightSince = getTime()
        }
        this.callbacks++
        if (gen !== this.captureGen || !this.hitsOpen) {
          return
        }
        if (!hit) {
          this.noteMiss(job)
          return
        }
        if (!this.hitLiesOnRay(rayStart, rayEnd, hit.position)) {
          this.rejected++
          this.noteMiss(job)
          return
        }
        this.noteWorld(job, hit.position, hit.normal, camPos)
      })
      return true
    }
    if (this.source === "standin") {
      const probe = this.probes[probeIndex % this.probes.length]
      probe.rayCast(start, end, (hit: RayCastHit) => {
        if (!hit || this.source !== "standin" || gen !== this.captureGen || !this.hitsOpen) {
          return
        }
        this.noteWorld(job, hit.position, hit.normal, camPos)
      })
    }
    return true
  }

  private noteWorld(job: RayJob, position: vec3, normal: vec3, cameraPos: vec3): void {
    this.worldHits++
    if (this.source !== "world") {
      this.source = "world"
      if (!this.hitsOpen) {
        this.cells.clear()
        this.dirty = true
      }
      if (this.standInRoot) {
        this.standInRoot.enabled = false
      }
      print("[SpaceClip] scan source=world")
    }
    this.noteHit(job, position, normal, cameraPos)
  }

  private commitStandIn(camera: Camera): void {
    this.buildStandIn(camera)
    if (this.standInRoot) {
      this.standInRoot.enabled = true
    }
    this.source = "standin"
    print("[SpaceClip] scan source=standin PreviewRoomStandIn")
    const eye = camera.getTransform().getWorldPosition()
    const downEnd = new vec3(eye.x, eye.y - 400, eye.z)
    this.probes[0].rayCast(eye, downEnd, (hit: RayCastHit) => {
      if (hit) {
        print("[SpaceClip] stand-in floor ray hit")
        this.noteHit(this.job(0, 0), hit.position, hit.normal, eye)
      } else {
        print("[SpaceClip] stand-in floor ray missed")
      }
    })
  }

  private noteHit(job: RayJob, position: vec3, normal: vec3, cameraPos: vec3): void {
    if (!this.hitsOpen) {
      return
    }
    const seated = this.seatOnSurface(position, cameraPos)
    const facing = facingNormal(normal, seated, cameraPos)
    if (this.editorCurtain(seated, facing, cameraPos)) {
      this.noteMiss(job)
      return
    }
    const key = this.cellKey(job.c, job.r)
    this.samples.set(key, {
      c: job.c,
      r: job.r,
      hit: true,
      position: seated,
      normal: facing,
    })
    this.sampleHits++
    if (!this.loggedHit) {
      this.loggedHit = true
      print(
        "[SpaceClip] first hit " +
          seated.x.toFixed(0) +
          "," +
          seated.y.toFixed(0) +
          "," +
          seated.z.toFixed(0)
      )
    }
  }

  private noteMiss(job: RayJob): void {
    const key = this.cellKey(job.c, job.r)
    if (this.samples.has(key)) {
      return
    }
    this.samples.set(key, {
      c: job.c,
      r: job.r,
      hit: false,
      position: vec3.zero(),
      normal: vec3.up(),
    })
  }

  private finishCapture(): void {
    if (!this.hitsOpen && !this.capturing) {
      return
    }
    this.capturing = false
    this.draining = false
    this.hitsOpen = false
    this.extractStrokes()
    this.dirty = true
    this.rebuildIfDirty()
    print(
      "[SpaceClip] clip captured cells=" +
        this.cells.size +
        " samples=" +
        this.sampleHits +
        " refine=" +
        this.refineCount
    )
  }

  private coarseJobs(): RayJob[] {
    const jobs: RayJob[] = []
    for (let r = 0; r <= FINE_R; r += COARSE) {
      for (let c = 0; c <= FINE_C; c += COARSE) {
        jobs.push(this.job(c, r))
      }
    }
    return jobs
  }

  private job(c: number, r: number): RayJob {
    return {
      c: c,
      r: r,
      u: UV0 + (c / FINE_C) * (UV1 - UV0),
      v: UV0 + (r / FINE_R) * (UV1 - UV0),
    }
  }

  private cellKey(c: number, r: number): string {
    return c + "," + r
  }

  private sampleAt(c: number, r: number): SurfSample | null {
    if (c < 0 || r < 0 || c > FINE_C || r > FINE_R) {
      return null
    }
    const sample = this.samples.get(this.cellKey(c, r))
    return sample ? sample : null
  }

  /** Fill the quads whose corners are not the same flat surface. */
  private buildRefineJobs(): RayJob[] {
    const wanted: string[] = []
    const seen: {[key: string]: boolean} = {}
    for (let r = 0; r < FINE_R; r += COARSE) {
      for (let c = 0; c < FINE_C; c += COARSE) {
        if (!this.quadIsInteresting(c, r)) {
          continue
        }
        for (let rr = r; rr <= r + COARSE && rr <= FINE_R; rr++) {
          for (let cc = c; cc <= c + COARSE && cc <= FINE_C; cc++) {
            const key = this.cellKey(cc, rr)
            if (seen[key] || this.samples.has(key) || this.issued.has(key)) {
              continue
            }
            seen[key] = true
            wanted.push(key)
          }
        }
      }
    }
    const jobs: RayJob[] = []
    const cap = 720
    for (let i = 0; i < wanted.length && jobs.length < cap; i++) {
      const comma = wanted[i].indexOf(",")
      const cc = parseInt(wanted[i].substring(0, comma), 10)
      const rr = parseInt(wanted[i].substring(comma + 1), 10)
      jobs.push(this.job(cc, rr))
    }
    return jobs
  }

  private quadIsInteresting(c: number, r: number): boolean {
    const corners = [
      this.sampleAt(c, r),
      this.sampleAt(c + COARSE, r),
      this.sampleAt(c, r + COARSE),
      this.sampleAt(c + COARSE, r + COARSE),
    ]
    let hits = 0
    for (let i = 0; i < corners.length; i++) {
      const corner = corners[i]
      if (corner !== null && corner.hit) {
        hits++
      }
    }
    if (hits === 0) {
      return false
    }
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        const a = corners[i]
        const b = corners[j]
        if (a === null || b === null) {
          continue
        }
        if (a.hit !== b.hit) {
          return true
        }
        if (a.hit && b.hit && this.breaks(a, b)) {
          return true
        }
      }
    }
    return false
  }

  private extractStrokes(): void {
    if (this.previewCapture) {
      this.snapshotPreviewRoom()
    } else {
      this.formingOwner = ""
      this.snapshotWorldMesh()
      this.focusOneObject()
    }
    this.beginForm()
  }

  /** Draw only the part of an edge that has been reached by the rising scan. */
  private clipRising(a: vec3, b: vec3, limit: number): vec3[] | null {
    const ay = a.y
    const by = b.y
    if (ay <= limit && by <= limit) {
      return [a, b]
    }
    if (ay > limit && by > limit) {
      return null
    }
    const span = by - ay
    if (Math.abs(span) < 0.001) {
      return null
    }
    const t = (limit - ay) / span
    const cut = a.add(b.sub(a).uniformScale(t))
    if (ay < by) {
      return [a, cut]
    }
    return [cut, b]
  }

  /**
   * Editor only. The demo chair or table hit by the center ray.
   * Edges come from each part's own mesh bounds and world transform.
   */
  private snapshotPreviewRoom(): void {
    this.source = "preview"
    const cam = this.captureCam
    let look = this.captureLook
    if (look.length < 0.001) {
      look = new vec3(0, 0, -1)
    } else {
      look = look.normalize()
    }
    const chosen = this.captureRoot !== null ? this.captureRoot : this.demoRootOnRay(this.demoRoots(), cam, look)
    if (chosen !== null) {
      this.formingOwner = chosen.name
      if (this.captureRoot === null && this.removeOwner(chosen.name) > 0) {
        print("[SpaceClip] reclip " + chosen.name + ", replaced old wire")
      }
      this.emitDemoRoot(chosen)
    }
    print("[SpaceClip] preview object " + (chosen ? chosen.name : "none") + " edges=" + this.cells.size)
  }

  /** Demo furniture, wherever it sits in the scene. */
  private demoRoots(): SceneObject[] {
    const found: SceneObject[] = []
    const count = global.scene.getRootObjectsCount()
    for (let i = 0; i < count; i++) {
      this.collectDemoRoots(global.scene.getRootObject(i), found)
    }
    return found
  }

  private collectDemoRoots(obj: SceneObject, found: SceneObject[]): void {
    if (
      obj.name === "DemoChair" ||
      obj.name === "DemoTable" ||
      obj.name === "DemoShelf" ||
      obj.name === "DemoComputer"
    ) {
      found.push(obj)
      return
    }
    const kids = obj.getChildrenCount()
    for (let i = 0; i < kids; i++) {
      this.collectDemoRoots(obj.getChild(i), found)
    }
  }

  /** First demo object the center ray hits. Otherwise the one nearest the screen center. */
  private demoRootOnRay(roots: SceneObject[], cam: vec3, look: vec3): SceneObject | null {
    let best: SceneObject | null = null
    let bestT = 1e9
    for (let i = 0; i < roots.length; i++) {
      const t = this.demoRayHit(roots[i], cam, look)
      if (t !== null && t < bestT) {
        bestT = t
        best = roots[i]
      }
    }
    if (best !== null) {
      print("[SpaceClip] ray hit " + best.name + " t=" + bestT.toFixed(0))
      return best
    }
    const camera = this.captureCamera
    let fallback: SceneObject | null = null
    let bestScore = 1e9
    for (let i = 0; i < roots.length; i++) {
      const center = this.demoCenter(roots[i])
      let score = 1e6
      if (camera) {
        const uv = camera.worldSpaceToScreenSpace(center)
        const du = uv.x - 0.5
        const dv = uv.y - 0.5
        score = du * du + dv * dv
      }
      if (score < bestScore) {
        bestScore = score
        fallback = roots[i]
      }
    }
    if (fallback !== null) {
      print("[SpaceClip] center fallback " + fallback.name)
    }
    return fallback
  }

  /** Closest hit, in centimeters, of the center ray against one demo object's parts. */
  private demoRayHit(root: SceneObject, cam: vec3, look: vec3): number | null {
    let best: number | null = null
    const walk = (obj: SceneObject): void => {
      const visual = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (visual && obj.enabled) {
        const t = this.rayVisual(visual, cam, look)
        if (t !== null && (best === null || t < best)) {
          best = t
        }
      }
      const kids = obj.getChildrenCount()
      for (let i = 0; i < kids; i++) {
        walk(obj.getChild(i))
      }
    }
    walk(root)
    return best
  }

  /** Ray against the mesh's world bounds. The box parts are unrotated, so the world box is the mesh. */
  private rayVisual(visual: RenderMeshVisual, cam: vec3, look: vec3): number | null {
    return this.rayAabb(cam, look, visual.worldAabbMin(), visual.worldAabbMax())
  }

  private rayAabb(origin: vec3, dir: vec3, min: vec3, max: vec3): number | null {
    const o = [origin.x, origin.y, origin.z]
    const d = [dir.x, dir.y, dir.z]
    const lo = [min.x, min.y, min.z]
    const hi = [max.x, max.y, max.z]
    let t0 = 15
    let t1 = 800
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-6) {
        if (o[a] < lo[a] || o[a] > hi[a]) {
          return null
        }
        continue
      }
      let ta = (lo[a] - o[a]) / d[a]
      let tb = (hi[a] - o[a]) / d[a]
      if (ta > tb) {
        const swap = ta
        ta = tb
        tb = swap
      }
      if (ta > t0) {
        t0 = ta
      }
      if (tb < t1) {
        t1 = tb
      }
      if (t0 > t1) {
        return null
      }
    }
    return t0
  }

  private demoCenter(root: SceneObject): vec3 {
    let count = 0
    let sum = vec3.zero()
    const walk = (obj: SceneObject): void => {
      const visual = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (visual) {
        const min = visual.worldAabbMin()
        const max = visual.worldAabbMax()
        sum = sum.add(min.add(max).uniformScale(0.5))
        count++
      }
      const kids = obj.getChildrenCount()
      for (let i = 0; i < kids; i++) {
        walk(obj.getChild(i))
      }
    }
    walk(root)
    if (count === 0) {
      return root.getTransform().getWorldPosition()
    }
    return sum.uniformScale(1 / count)
  }

  /** Sharp edges of every box part, in world space. Each box is its own part. */
  private emitDemoRoot(root: SceneObject): void {
    const owner = root.name
    const walk = (obj: SceneObject): void => {
      const visual = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (visual && obj.enabled) {
        const part = this.nextPartId
        this.nextPartId++
        this.partNames[part] = this.demoPartName(obj)
        this.emitBoxEdges(visual, part, owner)
      }
      const kids = obj.getChildrenCount()
      for (let i = 0; i < kids; i++) {
        walk(obj.getChild(i))
      }
    }
    walk(root)
  }

  /** Name used in the Logger, for example leg_front_right or seat. */
  partLabel(id: number): string {
    if (id <= 0) {
      return "lines"
    }
    const name = this.partNames[id]
    return name ? name : "part"
  }

  private demoPartName(obj: SceneObject): string {
    const n = obj.name
    const p = obj.getTransform().getLocalPosition()
    if (n.indexOf("Book") >= 0) {
      return "book_" + Math.round(p.y)
    }
    if (n.indexOf("Board") >= 0) {
      return "shelf_" + Math.round(p.y)
    }
    if (n.indexOf("Monitor") >= 0) {
      return "monitor"
    }
    if (n.indexOf("Keyboard") >= 0) {
      return "keyboard"
    }
    if (n.indexOf("Neck") >= 0) {
      return "neck"
    }
    if (n.indexOf("Side") >= 0) {
      return p.x >= 0 ? "side_right" : "side_left"
    }
    if (n.indexOf("Bottom") >= 0) {
      return "bottom"
    }
    if (n.indexOf("Base") >= 0) {
      return "base"
    }
    if (n.indexOf("Seat") >= 0) {
      return "seat"
    }
    if (n.indexOf("Back") >= 0) {
      return "back"
    }
    if (n.indexOf("Top") >= 0) {
      return "top"
    }
    if (n.indexOf("Leg") >= 0) {
      const side = p.x >= 0 ? "right" : "left"
      const depth = p.z >= 0 ? "front" : "back"
      return "leg_" + depth + "_" + side
    }
    return n.length > 0 ? n : "part"
  }

  private emitBoxEdges(visual: RenderMeshVisual, objectId: number, owner: string): void {
    const min = visual.localAabbMin()
    const max = visual.localAabbMax()
    const world = visual.getSceneObject().getTransform().getWorldTransform()
    const c = [
      new vec3(min.x, min.y, min.z),
      new vec3(max.x, min.y, min.z),
      new vec3(max.x, min.y, max.z),
      new vec3(min.x, min.y, max.z),
      new vec3(min.x, max.y, min.z),
      new vec3(max.x, max.y, min.z),
      new vec3(max.x, max.y, max.z),
      new vec3(min.x, max.y, max.z),
    ]
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]
    for (let e = 0; e < edges.length; e++) {
      const a = world.multiplyPoint(c[edges[e][0]])
      const b = world.multiplyPoint(c[edges[e][1]])
      const mid = a.add(b).uniformScale(0.5)
      this.addStroke(a, b, this.captureCam.sub(mid), false, objectId, owner)
    }
  }

  /** Every sane mesh box, in the solved room pose. Debug only. */
  private emitPreviewBoxes(room: BakedObject[]): void {
    const cam = this.captureCam
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const sx = obj.maxX - obj.minX
      const sy = obj.maxY - obj.minY
      const sz = obj.maxZ - obj.minZ
      if (sx < 8 && sy < 8 && sz < 8) {
        continue
      }
      if (sx > 2500 || sy > 2500 || sz > 2500) {
        continue
      }
      const center = this.bakedToWorld((obj.minX + obj.maxX) * 0.5, (obj.minY + obj.maxY) * 0.5, (obj.minZ + obj.maxZ) * 0.5)
      if (center.sub(cam).length > 550) {
        continue
      }
      this.emitBox(obj)
    }
  }

  private emitBox(obj: BakedObject): void {
    const c = [
      [obj.minX, obj.minY, obj.minZ],
      [obj.maxX, obj.minY, obj.minZ],
      [obj.maxX, obj.minY, obj.maxZ],
      [obj.minX, obj.minY, obj.maxZ],
      [obj.minX, obj.maxY, obj.minZ],
      [obj.maxX, obj.maxY, obj.minZ],
      [obj.maxX, obj.maxY, obj.maxZ],
      [obj.minX, obj.maxY, obj.maxZ],
    ]
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]
    for (let e = 0; e < edges.length; e++) {
      const a = c[edges[e][0]]
      const b = c[edges[e][1]]
      const wa = this.bakedToWorld(a[0], a[1], a[2])
      const wb = this.bakedToWorld(b[0], b[1], b[2])
      this.addStroke(wa, wb, vec3.up(), obj.dim, obj.id)
    }
  }

  /**
   * Ray from the view center. The first mesh that is not floor, wall, or ceiling wins.
   * If the ray misses, the object whose center is closest to the screen center is used.
   */
  private previewObjectOnRay(room: BakedObject[], cam: vec3, look: vec3): BakedObject | null {
    const origin = this.worldToBaked(cam)
    const dir = this.worldDirToBaked(look)
    let best: BakedObject | null = null
    let bestT = 1e9
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      if (obj.dim) {
        continue
      }
      const t = this.rayBox(origin, dir, obj)
      if (t !== null && t < bestT) {
        bestT = t
        best = obj
      }
    }
    if (best !== null) {
      print("[SpaceClip] ray hit id=" + best.id + " t=" + bestT.toFixed(0))
      return best
    }
    const fallback = this.previewObjectAtCenter(room, cam, look)
    if (fallback !== null) {
      return fallback
    }
    let nearest: BakedObject | null = null
    let nearestD = 1e9
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const world = this.bakedToWorld((obj.minX + obj.maxX) * 0.5, (obj.minY + obj.maxY) * 0.5, (obj.minZ + obj.maxZ) * 0.5)
      const d = world.sub(cam).length
      if (d < nearestD) {
        nearestD = d
        nearest = obj
      }
    }
    return nearest
  }

  /** Distance along dir to the box, or null. dir does not need to be a unit vector. */
  private rayBox(origin: vec3, dir: vec3, obj: BakedObject): number | null {
    const min = [obj.minX, obj.minY, obj.minZ]
    const max = [obj.maxX, obj.maxY, obj.maxZ]
    const o = [origin.x, origin.y, origin.z]
    const d = [dir.x, dir.y, dir.z]
    let t0 = 15
    let t1 = 800
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-5) {
        if (o[a] < min[a] || o[a] > max[a]) {
          return null
        }
        continue
      }
      let ta = (min[a] - o[a]) / d[a]
      let tb = (max[a] - o[a]) / d[a]
      if (ta > tb) {
        const swap = ta
        ta = tb
        tb = swap
      }
      if (ta > t0) {
        t0 = ta
      }
      if (tb < t1) {
        t1 = tb
      }
      if (t0 > t1) {
        return null
      }
    }
    return t0
  }

  /** Furniture whose center lands closest to the middle of the screen. */
  private previewObjectAtCenter(room: BakedObject[], cam: vec3, look: vec3): BakedObject | null {
    const camera = this.captureCamera
    let best: BakedObject | null = null
    let bestScore = 1e9
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      if (obj.dim) {
        continue
      }
      const world = this.bakedToWorld((obj.minX + obj.maxX) * 0.5, (obj.minY + obj.maxY) * 0.5, (obj.minZ + obj.maxZ) * 0.5)
      const to = world.sub(cam)
      const along = to.dot(look)
      if (along < 40 || along > 450) {
        continue
      }
      let score = 1e6
      if (camera) {
        const uv = camera.worldSpaceToScreenSpace(world)
        const du = uv.x - 0.5
        const dv = uv.y - 0.5
        score = du * du + dv * dv
      } else {
        score = to.dot(to) - along * along
      }
      if (score < bestScore) {
        bestScore = score
        best = obj
      }
    }
    if (best !== null && camera) {
      const world = this.bakedToWorld(
        (best.minX + best.maxX) * 0.5,
        (best.minY + best.maxY) * 0.5,
        (best.minZ + best.maxZ) * 0.5
      )
      const uv = camera.worldSpaceToScreenSpace(world)
      print(
        "[SpaceClip] center pick id=" +
          best.id +
          " uv=" +
          uv.x.toFixed(2) +
          "," +
          uv.y.toFixed(2) +
          " at " +
          world.x.toFixed(0) +
          "," +
          world.y.toFixed(0) +
          "," +
          world.z.toFixed(0) +
          " score=" +
          bestScore.toFixed(3)
      )
    }
    return best
  }

  /**
   * Move the chosen mesh onto the surface at the middle of the view.
   * A floor hit stands the object on that point. A seat or back uses the hit itself.
   */
  private anchorPreviewObject(): void {
    if (this.cells.size === 0 || this.previewAim === null) {
      return
    }
    let cx = 0
    let cy = 0
    let cz = 0
    let n = 0
    let minY = 1e9
    this.cells.forEach((cell) => {
      cx += cell.position.x
      cy += cell.position.y
      cz += cell.position.z
      n++
      if (cell.endA.y < minY) {
        minY = cell.endA.y
      }
      if (cell.endB.y < minY) {
        minY = cell.endB.y
      }
    })
    if (n === 0) {
      return
    }
    cx /= n
    cy /= n
    cz /= n
    const hit = this.previewAim
    const normal = this.previewAimN
    const floorKnown = this.previewFloor < 500
    let delta = vec3.zero()
    if (normal.y > 0.8 && floorKnown && hit.y < this.previewFloor + 22) {
      delta = new vec3(hit.x - cx, this.previewFloor - minY, hit.z - cz)
    } else if (normal.y > 0.6) {
      delta = new vec3(hit.x - cx, hit.y - cy, hit.z - cz)
    } else {
      const inside = hit.sub(normal.normalize().uniformScale(18))
      delta = new vec3(inside.x - cx, inside.y - cy, inside.z - cz)
    }
    if (delta.length > 40) {
      return
    }
    this.translate(delta)
    print(
      "[SpaceClip] anchored delta=" +
        delta.x.toFixed(0) +
        "," +
        delta.y.toFixed(0) +
        "," +
        delta.z.toFixed(0)
    )
  }

  /** Device World Mesh: the cluster on the view axis, without floor or walls. */
  private focusOneObject(): void {
    let look = this.captureLook
    if (look.length < 0.001) {
      look = new vec3(0, 0, -1)
    } else {
      look = look.normalize()
    }
    const cam = this.captureCam
    let seed: WireCell | null = null
    let seedSide = 1e9
    this.cells.forEach((cell) => {
      if (cell.dim) {
        return
      }
      const to = cell.position.sub(cam)
      const along = to.dot(look)
      if (along < 30 || along > 320) {
        return
      }
      const side = to.dot(to) - along * along
      if (side < seedSide) {
        seedSide = side
        seed = cell
      }
    })
    const keep: WireCell[] = []
    if (seed !== null) {
      const origin = seed.position
      this.cells.forEach((cell) => {
        if (!cell.dim && cell.position.sub(origin).length < 50) {
          keep.push(cell)
        }
      })
    }
    this.cells.clear()
    for (let i = 0; i < keep.length; i++) {
      this.cells.set(keep[i].key, keep[i])
    }
  }

  private beginForm(): void {
    const owner = this.formingOwner
    let count = 0
    let low = 1e9
    let high = -1e9
    this.cells.forEach((cell) => {
      if (owner !== "" && cell.owner !== owner) {
        return
      }
      count++
      low = Math.min(low, cell.endA.y, cell.endB.y)
      high = Math.max(high, cell.endA.y, cell.endB.y)
    })
    if (count === 0) {
      this.formStart = -1
      return
    }
    this.formLow = low
    this.formHigh = high < low + 1 ? low + 1 : high
    this.formStart = this.previewDebugBoxes ? -1 : getTime()
    this.dirty = true
  }

  private previewObjectVisible(obj: BakedObject, cam: vec3, look: vec3): boolean {
    if (obj.large) {
      return true
    }
    const x = cam.x < obj.minX ? obj.minX : cam.x > obj.maxX ? obj.maxX : cam.x
    const y = cam.y < obj.minY ? obj.minY : cam.y > obj.maxY ? obj.maxY : cam.y
    const z = cam.z < obj.minZ ? obj.minZ : cam.z > obj.maxZ ? obj.maxZ : cam.z
    const to = new vec3(x - cam.x, y - cam.y, z - cam.z)
    const dist = to.length
    if (dist > 300) {
      return false
    }
    if (dist < 25) {
      return true
    }
    return to.dot(look) > dist * 0.2
  }

  private emitPreviewObject(obj: BakedObject, cam: vec3, look: vec3): void {
    const always = obj.always
    for (let e = 0; e < always.length; e += 6) {
      this.emitPreviewEdge(obj, always[e], always[e + 1], always[e + 2], always[e + 3], always[e + 4], always[e + 5], cam, look)
    }
    const silPos = obj.silPos
    const silN = obj.silN
    const count = silN.length / 6
    for (let e = 0; e < count; e++) {
      const ax = silPos[e * 6]
      const ay = silPos[e * 6 + 1]
      const az = silPos[e * 6 + 2]
      const bx = silPos[e * 6 + 3]
      const by = silPos[e * 6 + 4]
      const bz = silPos[e * 6 + 5]
      const mid = this.bakedToWorld((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5)
      const toCam = cam.sub(mid)
      const n1 = this.bakedDirToWorld(silN[e * 6] / 127, silN[e * 6 + 1] / 127, silN[e * 6 + 2] / 127)
      const n2 = this.bakedDirToWorld(silN[e * 6 + 3] / 127, silN[e * 6 + 4] / 127, silN[e * 6 + 5] / 127)
      if (n1.dot(toCam) * n2.dot(toCam) >= 0) {
        continue
      }
      this.emitPreviewEdge(obj, ax, ay, az, bx, by, bz, cam, look)
    }
  }

  private emitPreviewEdge(
    obj: BakedObject,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cam: vec3,
    look: vec3
  ): void {
    const dx = ax - bx
    const dy = ay - by
    const dz = az - bz
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (len < 4) {
      return
    }
    const rise = Math.abs(dy) / len
    // Keep level rims, uprights, and the longer diagonals. Drop short triangle noise.
    if (rise > 0.28 && rise < 0.75 && len < 10) {
      return
    }
    const a = this.bakedToWorld(ax, ay, az)
    const b = this.bakedToWorld(bx, by, bz)
    if (obj.large && !this.previewEdgeInFront(a, b, cam, look)) {
      return
    }
    const mid = a.add(b).uniformScale(0.5)
    const toCam = cam.sub(mid)
    const dist = toCam.length
    if (dist < 1) {
      return
    }
    const shift = toCam.uniformScale(1.5 / dist)
    this.addStroke(a.add(shift), b.add(shift), toCam, obj.dim, obj.id)
  }

  /** Slide the baked room onto the surfaces the preview depth buffer hits. */
  private beginPreviewAlign(camera: Camera): void {
    this.previewHits = []
    this.previewNormals = []
    this.previewShift = vec3.zero()
    this.previewAim = null
    this.previewAimScore = 1e9
    this.previewFloor = 9999
    this.previewProbesLeft = 0
    if (!this.session) {
      return
    }
    const samples: number[][] = []
    for (let u = 0.12; u <= 0.9; u += 0.13) {
      for (let v = 0.22; v <= 0.86; v += 0.16) {
        samples.push([u, v])
      }
    }
    this.previewProbesLeft = samples.length
    const gen = this.captureGen
    for (let i = 0; i < samples.length; i++) {
      const uv = new vec2(samples[i][0], samples[i][1])
      const start = camera.screenSpaceToWorldSpace(uv, 30)
      const end = camera.screenSpaceToWorldSpace(uv, 500)
      this.session.hitTest(start, end, (hit: WorldQueryHitTestResult) => {
        if (gen === this.captureGen && hit) {
          const n = hit.normal
          this.previewHits.push(hit.position)
          this.previewNormals.push(n)
          const du = uv.x - 0.5
          const dv = uv.y - 0.5
          const score = du * du + dv * dv
          if (score < this.previewAimScore) {
            this.previewAimScore = score
            this.previewAim = hit.position
            this.previewAimN = n
          }
          if (n.y > 0.85 && hit.position.y < this.previewFloor) {
            this.previewFloor = hit.position.y
          }
          print(
            "[SpaceClip] hit u" +
              uv.x.toFixed(2) +
              " v" +
              uv.y.toFixed(2) +
              " " +
              hit.position.x.toFixed(0) +
              "," +
              hit.position.y.toFixed(0) +
              "," +
              hit.position.z.toFixed(0) +
              " n " +
              n.x.toFixed(2) +
              "," +
              n.y.toFixed(2) +
              "," +
              n.z.toFixed(2)
          )
        }
        if (gen === this.captureGen) {
          this.previewProbesLeft--
        }
      })
    }
  }

  private finishPreviewAlign(): void {
    if (this.previewProbesLeft < -1) {
      return
    }
    this.previewProbesLeft = -2
    this.solvePreviewPose(bakedRoom())
    print(
      "[SpaceClip] preview align shift=" +
        this.previewShift.x.toFixed(0) +
        "," +
        this.previewShift.y.toFixed(0) +
        "," +
        this.previewShift.z.toFixed(0)
    )
    this.finishCapture()
  }

  /**
   * Colorful Home vertices are one centimeter room: floor on y, long walls on
   * X or Z. Yaw comes from turning a long wall's normal onto the wall the
   * depth buffer hit. The slide along that wall is the one that drops the
   * raised horizontal hits onto a mesh top. No typed-in offset.
   */
  private solvePreviewPose(room: BakedObject[]): void {
    let floorY = 0
    let floorArea = 0
    let fcx = 0
    let fcz = 0
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const sx = obj.maxX - obj.minX
      const sy = obj.maxY - obj.minY
      const sz = obj.maxZ - obj.minZ
      if (sy < 30 && sx > 400 && sz > 400 && sx * sz > floorArea) {
        floorArea = sx * sz
        floorY = obj.maxY
        fcx = (obj.minX + obj.maxX) * 0.5
        fcz = (obj.minZ + obj.maxZ) * 0.5
      }
    }
    const worldFloor = this.previewFloor < 500 ? this.previewFloor : -136
    const buckets: {x: number; z: number; n: number; pts: vec3[]}[] = []
    const raised: vec3[] = []
    for (let i = 0; i < this.previewHits.length && i < this.previewNormals.length; i++) {
      const p = this.previewHits[i]
      const n = this.previewNormals[i]
      if (n.y > 0.8 && p.y > worldFloor + 35 && p.y < worldFloor + 110) {
        raised.push(p)
        continue
      }
      if (Math.abs(n.y) > 0.35) {
        continue
      }
      const horiz = Math.sqrt(n.x * n.x + n.z * n.z) || 1
      const hx = n.x / horiz
      const hz = n.z / horiz
      let placed = false
      for (let b = 0; b < buckets.length; b++) {
        const dot = buckets[b].x * hx + buckets[b].z * hz
        if (dot > 0.9) {
          buckets[b].x += hx
          buckets[b].z += hz
          buckets[b].n++
          buckets[b].pts.push(p)
          placed = true
          break
        }
      }
      if (!placed) {
        buckets.push({x: hx, z: hz, n: 1, pts: [p]})
      }
    }
    let wallN = new vec3(1, 0, 0)
    let wallPts: vec3[] = []
    let wallCount = 0
    for (let b = 0; b < buckets.length; b++) {
      if (buckets[b].n > wallCount) {
        wallCount = buckets[b].n
        const len = Math.sqrt(buckets[b].x * buckets[b].x + buckets[b].z * buckets[b].z) || 1
        wallN = new vec3(buckets[b].x / len, 0, buckets[b].z / len)
        wallPts = buckets[b].pts
      }
    }
    let planeD = 0
    for (let i = 0; i < wallPts.length; i++) {
      planeD += wallN.x * wallPts[i].x + wallN.z * wallPts[i].z
    }
    planeD = wallPts.length > 0 ? planeD / wallPts.length : 0
    const shells: number[][] = []
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const sx = obj.maxX - obj.minX
      const sy = obj.maxY - obj.minY
      const sz = obj.maxZ - obj.minZ
      if (sy < 180 || Math.min(sx, sz) > 40 || Math.max(sx, sz) < 400) {
        continue
      }
      if (sx < sz) {
        const mid = (obj.minX + obj.maxX) * 0.5
        const sign = fcx >= mid ? 1 : -1
        shells.push([0, sign, sign > 0 ? obj.maxX : obj.minX, obj.minZ, obj.maxZ])
      } else {
        const mid = (obj.minZ + obj.maxZ) * 0.5
        const sign = fcz >= mid ? 1 : -1
        shells.push([2, sign, sign > 0 ? obj.maxZ : obj.minZ, obj.minX, obj.maxX])
      }
    }
    let bestErr = 1e9
    let bestYaw = 0
    let bestTx = 0
    let bestTz = 0
    for (let w = 0; w < shells.length; w++) {
      const axis = shells[w][0]
      const sign = shells[w][1]
      const coord = shells[w][2]
      const minU = shells[w][3]
      const maxU = shells[w][4]
      const bx = axis === 0 ? sign : 0
      const bz = axis === 2 ? sign : 0
      const yaw = Math.atan2(wallN.z, wallN.x) - Math.atan2(bz, bx)
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const nT = planeD - coord
      for (let step = -24; step <= 24; step++) {
        const slide = step * 50
        const tx = nT * wallN.x + slide * -wallN.z
        const tz = nT * wallN.z + slide * wallN.x
        let outside = 0
        for (let h = 0; h < wallPts.length; h++) {
          const dx = wallPts[h].x - tx
          const dz = wallPts[h].z - tz
          const along = axis === 0 ? -dx * sin + dz * cos : dx * cos + dz * sin
          if (along < minU - 40 || along > maxU + 40) {
            outside++
          }
        }
        if (wallPts.length > 0 && outside > wallPts.length * 0.4) {
          continue
        }
        let err = outside * 80
        for (let h = 0; h < raised.length; h++) {
          const dx = raised[h].x - tx
          const dz = raised[h].z - tz
          const qx = dx * cos + dz * sin
          const qz = -dx * sin + dz * cos
          const qy = raised[h].y - worldFloor + floorY
          let nearest = 400
          for (let o = 0; o < room.length; o++) {
            const obj = room[o]
            if (obj.dim) {
              continue
            }
            const tall = obj.maxY - obj.minY
            if (tall < 20 || tall > 180) {
              continue
            }
            const cx = qx < obj.minX ? obj.minX : qx > obj.maxX ? obj.maxX : qx
            const cz = qz < obj.minZ ? obj.minZ : qz > obj.maxZ ? obj.maxZ : qz
            const dy = qy - obj.maxY
            const dist = Math.sqrt((qx - cx) * (qx - cx) + (qz - cz) * (qz - cz) + dy * dy)
            if (dist < nearest) {
              nearest = dist
            }
          }
          err += nearest
        }
        if (raised.length === 0) {
          err += 200
        }
        if (err < bestErr) {
          bestErr = err
          bestYaw = yaw
          bestTx = tx
          bestTz = tz
        }
      }
    }
    this.previewCos = Math.cos(bestYaw)
    this.previewSin = Math.sin(bestYaw)
    this.previewShift = new vec3(bestTx, worldFloor - floorY, bestTz)
    for (let h = 0; h < raised.length; h++) {
      const baked = this.worldToBaked(raised[h])
      print(
        "[SpaceClip] raised baked " +
          baked.x.toFixed(0) +
          "," +
          baked.y.toFixed(0) +
          "," +
          baked.z.toFixed(0)
      )
    }
    print(
      "[SpaceClip] room pose yaw=" +
        ((bestYaw * 180) / Math.PI).toFixed(1) +
        " err=" +
        bestErr.toFixed(0) +
        " shells=" +
        shells.length +
        " raised=" +
        raised.length +
        " wallHits=" +
        wallPts.length
    )
    return
  }

  private solvePreviewPoseUnused(room: BakedObject[]): void {
    const walls = this.collectBakedWalls(room)
    let floorY = 0
    let floorArea = 0
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const sx = obj.maxX - obj.minX
      const sy = obj.maxY - obj.minY
      const sz = obj.maxZ - obj.minZ
      if (sy < 30 && sx > 400 && sz > 400 && sx * sz > floorArea) {
        floorArea = sx * sz
        floorY = obj.maxY
      }
    }
    const worldFloor = this.previewFloor < 500 ? this.previewFloor : -136
    const hits: vec3[] = []
    const norms: vec3[] = []
    for (let i = 0; i < this.previewHits.length && i < this.previewNormals.length; i++) {
      if (Math.abs(this.previewNormals[i].y) < 0.4) {
        hits.push(this.previewHits[i])
        norms.push(this.previewNormals[i])
      }
    }
    const yaws: number[] = []
    for (let h = 0; h < norms.length; h++) {
      const n = norms[h]
      for (let axis = 0; axis <= 2; axis += 2) {
        for (let sign = -1; sign <= 1; sign += 2) {
          const bx = axis === 0 ? sign : 0
          const bz = axis === 2 ? sign : 0
          yaws.push(Math.atan2(n.z, n.x) - Math.atan2(bz, bx))
        }
      }
    }
    const unique: number[] = []
    for (let i = 0; i < yaws.length; i++) {
      let seen = false
      for (let j = 0; j < unique.length; j++) {
        let d = yaws[i] - unique[j]
        while (d > Math.PI) {
          d -= Math.PI * 2
        }
        while (d < -Math.PI) {
          d += Math.PI * 2
        }
        if (Math.abs(d) < 0.05) {
          seen = true
        }
      }
      if (!seen) {
        unique.push(yaws[i])
      }
    }
    if (unique.length === 0) {
      unique.push(0)
    }
    let bestIn = -1
    let bestErr = 1e9
    let bestYaw = 0
    let bestUx = 0
    let bestUz = 0
    for (let i = 0; i < unique.length; i++) {
      const scored = this.scoreRoomYaw(unique[i], walls, hits, norms)
      if (scored[0] > bestIn || (scored[0] === bestIn && scored[1] < bestErr)) {
        bestIn = scored[0]
        bestErr = scored[1]
        bestYaw = unique[i]
        bestUx = scored[2]
        bestUz = scored[3]
      }
    }
    this.previewCos = Math.cos(bestYaw)
    this.previewSin = Math.sin(bestYaw)
    this.previewShift = new vec3(
      bestUx * this.previewCos - bestUz * this.previewSin,
      worldFloor - floorY,
      bestUx * this.previewSin + bestUz * this.previewCos
    )
    print(
      "[SpaceClip] room pose yaw=" +
        ((bestYaw * 180) / Math.PI).toFixed(1) +
        " in=" +
        bestIn +
        " err=" +
        bestErr.toFixed(0) +
        " walls=" +
        walls.length +
        " wallHits=" +
        hits.length
    )
  }

  /** axis, sign, coord, minU, maxU, minY, maxY. Thin vertical meshes, inner face. */
  private collectBakedWalls(room: BakedObject[]): number[][] {
    let cx = 0
    let cz = 0
    let area = 0
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const sx = obj.maxX - obj.minX
      const sy = obj.maxY - obj.minY
      const sz = obj.maxZ - obj.minZ
      if (sy < 30 && sx > 400 && sz > 400 && sx * sz > area) {
        area = sx * sz
        cx = (obj.minX + obj.maxX) * 0.5
        cz = (obj.minZ + obj.maxZ) * 0.5
      }
    }
    const walls: number[][] = []
    for (let i = 0; i < room.length; i++) {
      const obj = room[i]
      const sx = obj.maxX - obj.minX
      const sy = obj.maxY - obj.minY
      const sz = obj.maxZ - obj.minZ
      if (sy < 140) {
        continue
      }
      if (sx < 45 && sz > 80) {
        const sign = cx >= (obj.minX + obj.maxX) * 0.5 ? 1 : -1
        walls.push([0, sign, sign > 0 ? obj.maxX : obj.minX, obj.minZ, obj.maxZ, obj.minY, obj.maxY])
      } else if (sz < 45 && sx > 80) {
        const sign = cz >= (obj.minZ + obj.maxZ) * 0.5 ? 1 : -1
        walls.push([2, sign, sign > 0 ? obj.maxZ : obj.minZ, obj.minX, obj.maxX, obj.minY, obj.maxY])
      }
    }
    return walls
  }

  /** Returns inRange, err, ux, uz. ux/uz are the baked-space slide. */
  private scoreRoomYaw(yaw: number, walls: number[][], hits: vec3[], norms: vec3[]): number[] {
    this.previewCos = Math.cos(yaw)
    this.previewSin = Math.sin(yaw)
    this.previewShift = vec3.zero()
    const xWalls: number[][] = []
    const zWalls: number[][] = []
    for (let i = 0; i < walls.length; i++) {
      if (walls[i][0] === 0) {
        xWalls.push(walls[i])
      } else {
        zWalls.push(walls[i])
      }
    }
    let bestIn = -1
    let bestErr = 1e9
    let bestUx = 0
    let bestUz = 0
    const xTry = xWalls.length > 0 ? xWalls : [null]
    const zTry = zWalls.length > 0 ? zWalls : [null]
    for (let xi = 0; xi < xTry.length; xi++) {
      for (let zi = 0; zi < zTry.length; zi++) {
        const xw = xTry[xi]
        const zw = zTry[zi]
        const uxS: number[] = []
        const uzS: number[] = []
        const xq: vec3[] = []
        const zq: vec3[] = []
        for (let h = 0; h < hits.length; h++) {
          const q = this.worldToBaked(hits[h])
          const bn = this.worldDirToBaked(norms[h])
          if (xw && Math.abs(bn.x) >= Math.abs(bn.z) && bn.x * xw[1] > 0.55) {
            uxS.push(q.x - xw[2])
            xq.push(q)
          } else if (zw && Math.abs(bn.z) > Math.abs(bn.x) && bn.z * zw[1] > 0.55) {
            uzS.push(q.z - zw[2])
            zq.push(q)
          }
        }
        if (xw && uxS.length === 0) {
          continue
        }
        if (zw && uzS.length === 0) {
          continue
        }
        const ux = uxS.length > 0 ? this.median(uxS) : 0
        const uz = uzS.length > 0 ? this.median(uzS) : 0
        let inside = 0
        let err = 0
        if (xw) {
          for (let k = 0; k < xq.length; k++) {
            const along = xq[k].z - uz
            err += Math.abs(xq[k].x - ux - xw[2])
            if (along >= xw[3] - 30 && along <= xw[4] + 30 && xq[k].y >= xw[5] - 40 && xq[k].y <= xw[6] + 40) {
              inside++
            }
          }
        }
        if (zw) {
          for (let k = 0; k < zq.length; k++) {
            const along = zq[k].x - ux
            err += Math.abs(zq[k].z - uz - zw[2])
            if (along >= zw[3] - 30 && along <= zw[4] + 30 && zq[k].y >= zw[5] - 40 && zq[k].y <= zw[6] + 40) {
              inside++
            }
          }
        }
        if (inside > bestIn || (inside === bestIn && err < bestErr)) {
          bestIn = inside
          bestErr = err
          bestUx = ux
          bestUz = uz
        }
      }
    }
    return [bestIn, bestErr, bestUx, bestUz]
  }

  private median(values: number[]): number {
    const copy = values.slice()
    copy.sort((a, b) => a - b)
    return copy[Math.floor(copy.length / 2)]
  }

  /** Baked centimeters to the preview tracking frame (yaw, then slide). */
  private bakedToWorld(x: number, y: number, z: number): vec3 {
    return new vec3(
      x * this.previewCos - z * this.previewSin + this.previewShift.x,
      y + this.previewShift.y,
      x * this.previewSin + z * this.previewCos + this.previewShift.z
    )
  }

  private worldToBaked(p: vec3): vec3 {
    const dx = p.x - this.previewShift.x
    const dz = p.z - this.previewShift.z
    return new vec3(
      dx * this.previewCos + dz * this.previewSin,
      p.y - this.previewShift.y,
      -dx * this.previewSin + dz * this.previewCos
    )
  }

  private worldDirToBaked(d: vec3): vec3 {
    return new vec3(
      d.x * this.previewCos + d.z * this.previewSin,
      d.y,
      -d.x * this.previewSin + d.z * this.previewCos
    )
  }

  private bakedDirToWorld(x: number, y: number, z: number): vec3 {
    return new vec3(x * this.previewCos - z * this.previewSin, y, x * this.previewSin + z * this.previewCos)
  }

  private previewEdgeInFront(a: vec3, b: vec3, cam: vec3, look: vec3): boolean {
    const mid = a.add(b).uniformScale(0.5)
    const to = mid.sub(cam)
    const along = to.dot(look)
    if (along < 25 || along > 420) {
      return false
    }
    const side2 = to.dot(to) - along * along
    const limit = along * 1.25 + 35
    return side2 < limit * limit
  }

  private attachWorldMesh(): void {
    try {
      this.worldMesh = WORLD_MESH
      const hidden = WIRE_MAT.clone()
      hidden.mainPass.blendMode = BlendMode.Normal
      hidden.mainPass.twoSided = true
      hidden.mainPass.depthWrite = false
      hidden.mainPass.depthTest = false
      hidden.mainPass.baseColor = new vec4(0, 0, 0, 0)
      const host = global.scene.createSceneObject("WorldMeshSource")
      host.setParent(this.sceneObject)
      this.worldVisual = host.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      this.worldVisual.mesh = WORLD_MESH
      this.worldVisual.mainMaterial = hidden
      this.worldVisual.enabled = false
      const provider = WORLD_MESH.control as WorldRenderObjectProvider
      provider.useNormals = true
      provider.meshClassificationFormat = MeshClassificationFormat.PerVertexFast
      provider.enableWorldMeshesTracking = true
      print("[SpaceClip] world mesh control " + provider.getTypeName())
    } catch (err) {
      print("[SpaceClip] world mesh setup failed. " + err)
      this.worldMesh = null
    }
  }

  private worldFaceCount(): number {
    if (this.worldMesh === null) {
      return 0
    }
    try {
      const provider = this.worldMesh.control as WorldRenderObjectProvider
      return provider.faceCount
    } catch (err) {
      return 0
    }
  }

  /**
   * Copy the live World Mesh once. Edges within 3 m become the sketch.
   * Large vertical planes and the lowest horizontal plane are faded.
   */
  private snapshotWorldMesh(): void {
    this.cells.clear()
    if (this.worldMesh === null || this.worldVisual === null) {
      print("[SpaceClip] world mesh missing")
      return
    }
    let positions: Float32Array
    let indices: Uint16Array | Uint32Array
    try {
      positions = this.worldMesh.getVertexDataForAttribute("position")
      indices = this.worldMesh.getIndexBuffer()
    } catch (err) {
      print("[SpaceClip] world mesh read failed. " + err)
      return
    }
    const vcount = Math.floor(positions.length / 3)
    if (vcount < 3 || indices.length < 3) {
      print("[SpaceClip] world mesh empty verts=" + vcount + " idx=" + indices.length)
      return
    }
    const wt = this.worldVisual.getSceneObject().getTransform().getWorldTransform()
    const triCount = Math.floor(indices.length / 3)
    const nearCount = (candidate: number): number => {
      let near = 0
      const step = Math.max(1, Math.floor(triCount / 500))
      for (let t = 0; t < triCount; t += step) {
        const ia = indices[t * 3]
        if (ia >= vcount) {
          continue
        }
        const p = wt.multiplyPoint(
          new vec3(positions[ia * 3] * candidate, positions[ia * 3 + 1] * candidate, positions[ia * 3 + 2] * candidate)
        )
        if (p.sub(this.captureCam).length < 300) {
          near++
        }
      }
      return near
    }
    const nearCm = nearCount(1)
    const nearM = nearCount(100)
    const scale = nearM > nearCm * 2 && nearM > 20 ? 100 : 1
    const pointAt = (index: number): vec3 => {
      const i3 = index * 3
      return wt.multiplyPoint(new vec3(positions[i3] * scale, positions[i3 + 1] * scale, positions[i3 + 2] * scale))
    }
    const weldPos: vec3[] = []
    const weldN: vec3[] = []
    const weldCount: number[] = []
    const weldIndex: {[key: string]: number} = {}
    const q = 5
    const weld = (p: vec3, n: vec3): number => {
      const key = Math.round(p.x / q) + "," + Math.round(p.y / q) + "," + Math.round(p.z / q)
      const found = weldIndex[key]
      if (found !== undefined) {
        weldPos[found] = weldPos[found].add(p)
        weldN[found] = weldN[found].add(n)
        weldCount[found] += 1
        return found
      }
      const id = weldPos.length
      weldIndex[key] = id
      weldPos.push(p)
      weldN.push(n)
      weldCount.push(1)
      return id
    }
    const tris: {a: number; b: number; c: number; n: vec3; mid: vec3; area: number; axis: string}[] = []
    const look = this.captureLook.length > 0.001 ? this.captureLook.normalize() : new vec3(0, 0, 1)
    for (let t = 0; t < triCount; t++) {
      const ia = indices[t * 3]
      const ib = indices[t * 3 + 1]
      const ic = indices[t * 3 + 2]
      if (ia >= vcount || ib >= vcount || ic >= vcount) {
        continue
      }
      const pa = pointAt(ia)
      const pb = pointAt(ib)
      const pc = pointAt(ic)
      const mid = pa.add(pb).add(pc).uniformScale(1 / 3)
      const to = mid.sub(this.captureCam)
      const dist = to.length
      if (dist < 20 || dist > 300) {
        continue
      }
      if (to.dot(look) < dist * 0.2) {
        continue
      }
      const e1 = pb.sub(pa)
      const e2 = pc.sub(pa)
      const rawN = e1.cross(e2)
      const area = rawN.length * 0.5
      if (area < 0.5 || area > 80000) {
        continue
      }
      const n = rawN.normalize()
      const wa = weld(pa, n)
      const wb = weld(pb, n)
      const wc = weld(pc, n)
      if (wa === wb || wb === wc || wa === wc) {
        continue
      }
      let ax = 0
      let ay = 0
      let az = 0
      if (Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z)) {
        ax = n.x >= 0 ? 1 : -1
      } else if (Math.abs(n.z) >= Math.abs(n.y)) {
        az = n.z >= 0 ? 1 : -1
      } else {
        ay = n.y >= 0 ? 1 : -1
      }
      const offset = mid.x * ax + mid.y * ay + mid.z * az
      tris.push({
        a: wa,
        b: wb,
        c: wc,
        n: n,
        mid: mid,
        area: area,
        axis: ax + "," + ay + "," + az + ":" + Math.round(offset / 25),
      })
    }
    for (let i = 0; i < weldPos.length; i++) {
      const c = weldCount[i] || 1
      weldPos[i] = weldPos[i].uniformScale(1 / c)
      weldN[i] = weldN[i].uniformScale(1 / c)
    }
    const planeArea: {[key: string]: number} = {}
    let floorY = 1e9
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i]
      if (Math.abs(tri.n.y) < 0.4) {
        planeArea[tri.axis] = (planeArea[tri.axis] || 0) + tri.area
      }
      if (tri.n.y > 0.75 && tri.mid.y < floorY) {
        floorY = tri.mid.y
      }
    }
    const brightEdge: {[key: string]: boolean} = {}
    const edgeA: number[] = []
    const edgeB: number[] = []
    const edgeBright: boolean[] = []
    const addEdge = (i0: number, i1: number, bright: boolean) => {
      if (i0 === i1) {
        return
      }
      const lo = i0 < i1 ? i0 : i1
      const hi = i0 < i1 ? i1 : i0
      const key = lo + "-" + hi
      const existing = brightEdge[key]
      if (existing === undefined) {
        brightEdge[key] = bright
        edgeA.push(lo)
        edgeB.push(hi)
        edgeBright.push(bright)
        return
      }
      if (bright && !existing) {
        brightEdge[key] = true
        for (let k = edgeA.length - 1; k >= 0; k--) {
          if (edgeA[k] === lo && edgeB[k] === hi) {
            edgeBright[k] = true
            break
          }
        }
      }
    }
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i]
      const wall = Math.abs(tri.n.y) < 0.4 && (planeArea[tri.axis] || 0) > 15000
      const floor = tri.n.y > 0.75 && tri.mid.y < floorY + 18
      const ceiling = tri.n.y < -0.75
      const bright = !wall && !floor && !ceiling
      addEdge(tri.a, tri.b, bright)
      addEdge(tri.b, tri.c, bright)
      addEdge(tri.c, tri.a, bright)
    }
    let kept = 0
    let brightKept = 0
    const emitEdge = (i: number) => {
      if (this.cells.size >= this.maxCells) {
        return
      }
      const a = weldPos[edgeA[i]]
      const b = weldPos[edgeB[i]]
      const len = b.sub(a).length
      if (len < 3 || len > 90) {
        return
      }
      const n = weldN[edgeA[i]].add(weldN[edgeB[i]])
      const mid = a.add(b).uniformScale(0.5)
      const toward = this.captureCam.sub(mid)
      const pull = toward.length > 1 ? toward.normalize().uniformScale(4) : vec3.zero()
      this.addStroke(a.add(pull), b.add(pull), this.faceCamera(n, mid), !edgeBright[i])
      kept++
      if (edgeBright[i]) {
        brightKept++
      }
    }
    for (let i = 0; i < edgeA.length; i++) {
      if (edgeBright[i]) {
        emitEdge(i)
      }
    }
    for (let i = 0; i < edgeA.length; i++) {
      if (!edgeBright[i]) {
        emitEdge(i)
      }
    }
    print(
      "[SpaceClip] world mesh verts=" +
        vcount +
        " tris=" +
        tris.length +
        " edges=" +
        kept +
        " bright=" +
        brightKept +
        " scale=" +
        scale
    )
    if (this.worldVisual) {
      this.worldVisual.enabled = false
    }
  }

  private extractStrokesUnused(): void {
    this.cells.clear()
    const ridge = new Set<string>()
    this.samples.forEach((sample) => {
      if (sample.hit && this.isContour(sample)) {
        ridge.add(this.cellKey(sample.c, sample.r))
      }
    })
    const nodes: SurfSample[] = []
    this.samples.forEach((sample) => {
      const key = this.cellKey(sample.c, sample.r)
      if (ridge.has(key) && this.isOuterEdge(sample, ridge)) {
        nodes.push(sample)
      }
    })
    const used: boolean[] = []
    for (let i = 0; i < nodes.length; i++) {
      used.push(false)
    }
    const runs: {a: vec3; b: vec3; n: vec3}[] = []
    for (let i = 0; i < nodes.length; i++) {
      if (used[i]) {
        continue
      }
      const nxt = this.straightNeighbor(nodes, used, i, null)
      if (nxt < 0) {
        continue
      }
      const dir = nodes[nxt].position.sub(nodes[i].position).normalize()
      const forward = this.growStraight(nodes, used, i, dir)
      const back = this.growStraight(nodes, used, i, dir.uniformScale(-1))
      used[i] = true
      const chain: vec3[] = []
      for (let k = back.length - 1; k >= 0; k--) {
        chain.push(nodes[back[k]].position)
      }
      chain.push(nodes[i].position)
      for (let k = 0; k < forward.length; k++) {
        chain.push(nodes[forward[k]].position)
      }
      if (chain.length < 2) {
        continue
      }
      const a = chain[0]
      const b = chain[chain.length - 1]
      if (b.sub(a).length < 16) {
        continue
      }
      runs.push({a: a, b: b, n: nodes[i].normal})
    }
    this.mergeCollinear(runs)
    let outlines = 0
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]
      if (run.b.sub(run.a).length < 16) {
        continue
      }
      const mid = run.a.add(run.b).uniformScale(0.5)
      this.addStroke(run.a, run.b, this.faceCamera(run.n, mid))
      outlines++
    }
    this.joinCorners(runs)
    print("[SpaceClip] outlines=" + outlines + " edgeHits=" + nodes.length)
  }

  /** Nearest unused edge hit that continues a straight line. */
  private straightNeighbor(nodes: SurfSample[], used: boolean[], from: number, dir: vec3 | null): number {
    let best = -1
    let bestDist = 18
    for (let j = 0; j < nodes.length; j++) {
      if (j === from || used[j] || !this.canJoin(nodes[from], nodes[j])) {
        continue
      }
      const grid = Math.max(Math.abs(nodes[j].c - nodes[from].c), Math.abs(nodes[j].r - nodes[from].r))
      if (grid > 2) {
        continue
      }
      const step = nodes[j].position.sub(nodes[from].position)
      const dist = step.length
      if (dist >= bestDist) {
        continue
      }
      if (dir !== null) {
        const along = step.dot(dir)
        if (along < 1.5) {
          continue
        }
        if (step.sub(dir.uniformScale(along)).length > 4.5) {
          continue
        }
      }
      bestDist = dist
      best = j
    }
    return best
  }

  private growStraight(nodes: SurfSample[], used: boolean[], from: number, dir: vec3): number[] {
    const grown: number[] = []
    let current = from
    for (let guard = 0; guard < 80; guard++) {
      const nxt = this.straightNeighbor(nodes, used, current, dir)
      if (nxt < 0) {
        break
      }
      used[nxt] = true
      grown.push(nxt)
      current = nxt
    }
    return grown
  }

  /** Pull two collinear runs that nearly meet into one stroke. */
  private mergeCollinear(runs: {a: vec3; b: vec3; n: vec3}[]): void {
    let changed = true
    while (changed) {
      changed = false
      for (let i = 0; i < runs.length; i++) {
        for (let j = i + 1; j < runs.length; j++) {
          const merged = this.tryMerge(runs[i], runs[j])
          if (merged === null) {
            continue
          }
          runs[i] = merged
          runs.splice(j, 1)
          changed = true
          break
        }
        if (changed) {
          break
        }
      }
    }
  }

  private tryMerge(p: {a: vec3; b: vec3; n: vec3}, q: {a: vec3; b: vec3; n: vec3}): {a: vec3; b: vec3; n: vec3} | null {
    const pd = p.b.sub(p.a)
    const qd = q.b.sub(q.a)
    const pl = pd.length || 1
    const ql = qd.length || 1
    if (Math.abs(pd.dot(qd) / (pl * ql)) < 0.9) {
      return null
    }
    const ends = [p.a, p.b, q.a, q.b]
    let near = 1e9
    for (let i = 0; i < 2; i++) {
      for (let j = 2; j < 4; j++) {
        const dist = ends[i].sub(ends[j]).length
        if (dist < near) {
          near = dist
        }
      }
    }
    if (near > 16) {
      return null
    }
    let farA = ends[0]
    let farB = ends[1]
    let far = farB.sub(farA).length
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const dist = ends[j].sub(ends[i]).length
        if (dist > far) {
          far = dist
          farA = ends[i]
          farB = ends[j]
        }
      }
    }
    return {a: farA, b: farB, n: p.n}
  }

  /** A short corner between two real edge ends. It does not invent a side across empty wall. */
  private joinCorners(runs: {a: vec3; b: vec3; n: vec3}[]): void {
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const pairs = [
          [runs[i].a, runs[i].b, runs[j].a, runs[j].b],
          [runs[i].a, runs[i].b, runs[j].b, runs[j].a],
          [runs[i].b, runs[i].a, runs[j].a, runs[j].b],
          [runs[i].b, runs[i].a, runs[j].b, runs[j].a],
        ]
        for (let k = 0; k < pairs.length; k++) {
          const endA = pairs[k][0]
          const outA = pairs[k][1]
          const endB = pairs[k][2]
          const outB = pairs[k][3]
          const gap = endB.sub(endA).length
          if (gap < 1 || gap > 14) {
            continue
          }
          const da = outA.sub(endA)
          const db = outB.sub(endB)
          const dot = da.normalize().dot(db.normalize())
          if (dot > 0.45) {
            continue
          }
          const mid = endA.add(endB).uniformScale(0.5)
          this.addStroke(endA, endB, this.faceCamera(runs[i].n, mid))
          break
        }
      }
    }
  }

  private meanCamDist(group: SurfSample[]): number {
    let total = 0
    for (let i = 0; i < group.length; i++) {
      total += group[i].position.sub(this.captureCam).length
    }
    return total / group.length
  }

  /** Join a straight run, including a gap of a couple of missed samples. */
  private linkSpan(sample: SurfSample, dc: number, dr: number, i: number, index: Map<string, number>, nodes: SurfSample[], nbrs: number[][]): void {
    for (let step = 1; step <= 3; step++) {
      const nc = sample.c + dc * step
      const nr = sample.r + dr * step
      const other = index.get(this.cellKey(nc, nr))
      if (other !== undefined) {
        if (other > i && this.canJoin(sample, nodes[other])) {
          nbrs[i].push(other)
          nbrs[other].push(i)
        }
        return
      }
      const mid = this.sampleAt(nc, nr)
      if (mid !== null && mid.hit && this.breaks(sample, mid)) {
        return
      }
    }
  }

  /** One flat face: shelf board, frame, screen, or cabinet side. */
  private growPatch(start: SurfSample, id: number, label: Map<string, number>): SurfSample[] {
    const group: SurfSample[] = []
    const stack: SurfSample[] = [start]
    label.set(this.cellKey(start.c, start.r), id)
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [2, 2],
      [2, -2],
      [-2, 2],
      [-2, -2],
    ]
    while (stack.length > 0) {
      const cur = stack[stack.length - 1]
      stack.pop()
      group.push(cur)
      for (let s = 0; s < steps.length; s++) {
        const dc = steps[s][0]
        const dr = steps[s][1]
        const next = this.sampleAt(cur.c + dc, cur.r + dr)
        if (next === null || !next.hit) {
          continue
        }
        const key = this.cellKey(next.c, next.r)
        if (label.has(key) || !this.sameFace(cur, next) || !this.onPlane(start, next)) {
          continue
        }
        if (Math.abs(dc) === 2 || Math.abs(dr) === 2) {
          const mid = this.sampleAt(cur.c + Math.round(dc / 2), cur.r + Math.round(dr / 2))
          if (mid !== null && mid.hit && (!this.sameFace(cur, mid) || !this.onPlane(start, mid))) {
            continue
          }
        }
        label.set(key, id)
        stack.push(next)
      }
    }
    return group
  }

  /** Same physical face. A few centimeters of depth noise stays together; a shelf in front of the wall does not. */
  private sameFace(a: SurfSample, b: SurfSample): boolean {
    const delta = b.position.sub(a.position)
    const dist = delta.length
    if (dist < 0.4) {
      return true
    }
    if (dist > 50) {
      return false
    }
    const na = a.normal.length > 0.001 ? a.normal.normalize() : new vec3(0, 1, 0)
    const nb = b.normal.length > 0.001 ? b.normal.normalize() : new vec3(0, 1, 0)
    if (Math.abs(na.dot(nb)) < 0.82) {
      return false
    }
    const gap = Math.max(Math.abs(delta.dot(na)), Math.abs(delta.dot(nb)))
    return gap < 5.5
  }

  /** Keep the face from walking off its plane onto the wall behind it. */
  private onPlane(seed: SurfSample, next: SurfSample): boolean {
    const n = seed.normal.length > 0.001 ? seed.normal.normalize() : new vec3(0, 1, 0)
    const nn = next.normal.length > 0.001 ? next.normal.normalize() : n
    if (Math.abs(n.dot(nn)) < 0.8) {
      return false
    }
    return Math.abs(next.position.sub(seed.position).dot(n)) < 8
  }

  /**
   * Closed outline around one face.
   * The loop follows the face boundary, including concave cabinet openings.
   * Straight runs are simplified, so a tilted edge becomes one angled stroke.
   */
  private emitPatchOutline(group: SurfSample[], _id: number, _label: Map<string, number>): boolean {
    return this.emitFaceRect(group)
  }

  /**
   * One straight rectangle on the face.
   * A thin lip becomes a single stroke. A board, frame, screen, or cabinet side
   * becomes a closed outline, tilted when the face is tilted.
   */
  private emitFaceRect(group: SurfSample[]): boolean {
    if (group.length < 5) {
      return false
    }
    let cx = 0
    let cy = 0
    let cz = 0
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < group.length; i++) {
      cx += group[i].position.x
      cy += group[i].position.y
      cz += group[i].position.z
      nx += group[i].normal.x
      ny += group[i].normal.y
      nz += group[i].normal.z
    }
    const n = group.length
    const origin = new vec3(cx / n, cy / n, cz / n)
    let normal = new vec3(nx, ny, nz)
    if (normal.length < 0.001) {
      normal = new vec3(0, 1, 0)
    } else {
      normal = normal.normalize()
    }
    const up = new vec3(0, 1, 0)
    const helper = Math.abs(normal.dot(up)) > 0.9 ? new vec3(1, 0, 0) : up
    const tangent = helper.cross(normal).normalize()
    const bitangent = normal.cross(tangent).normalize()
    let sxx = 0
    let syy = 0
    let sxy = 0
    const flat: {x: number; y: number}[] = []
    for (let i = 0; i < group.length; i++) {
      const delta = group[i].position.sub(origin)
      const x = delta.dot(tangent)
      const y = delta.dot(bitangent)
      flat.push({x: x, y: y})
      sxx += x * x
      syy += y * y
      sxy += x * y
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    let minU = 1e9
    let maxU = -1e9
    let minV = 1e9
    let maxV = -1e9
    for (let i = 0; i < flat.length; i++) {
      const u = flat[i].x * ca + flat[i].y * sa
      const v = -flat[i].x * sa + flat[i].y * ca
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const long = Math.max(maxU - minU, maxV - minV)
    const short = Math.min(maxU - minU, maxV - minV)
    if (long < 16 || long > 190) {
      return false
    }
    const face = this.faceCamera(normal, origin)
    const toWorld = (u: number, v: number): vec3 => {
      const x = u * ca - v * sa
      const y = u * sa + v * ca
      return origin.add(tangent.uniformScale(x)).add(bitangent.uniformScale(y))
    }
    if (short < 5) {
      const alongU = maxU - minU >= maxV - minV
      const a = alongU ? toWorld(minU, (minV + maxV) * 0.5) : toWorld((minU + maxU) * 0.5, minV)
      const b = alongU ? toWorld(maxU, (minV + maxV) * 0.5) : toWorld((minU + maxU) * 0.5, maxV)
      this.addStroke(a, b, face)
      return true
    }
    const corners = [
      toWorld(minU, minV),
      toWorld(maxU, minV),
      toWorld(maxU, maxV),
      toWorld(minU, maxV),
    ]
    for (let i = 0; i < 4; i++) {
      this.addStroke(corners[i], corners[(i + 1) % 4], face)
    }
    return true
  }

  private emitPatchOutlineUnused(group: SurfSample[], id: number, label: Map<string, number>): boolean {
    if (group.length < 4) {
      return false
    }
    const nodes: SurfSample[] = []
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < group.length; i++) {
      nx += group[i].normal.x
      ny += group[i].normal.y
      nz += group[i].normal.z
      if (this.isPatchEdge(group[i], id, label)) {
        nodes.push(group[i])
      }
    }
    if (nodes.length < 2) {
      return false
    }
    let normal = new vec3(nx, ny, nz)
    if (normal.length < 0.001) {
      normal = new vec3(0, 1, 0)
    } else {
      normal = normal.normalize()
    }
    const index = new Map<string, number>()
    const nbrs: number[][] = []
    for (let i = 0; i < nodes.length; i++) {
      index.set(this.cellKey(nodes[i].c, nodes[i].r), i)
      nbrs.push([])
    }
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (let i = 0; i < nodes.length; i++) {
      const sample = nodes[i]
      for (let d = 0; d < dirs.length; d++) {
        for (let step = 1; step <= 3; step++) {
          const nc = sample.c + dirs[d][0] * step
          const nr = sample.r + dirs[d][1] * step
          const other = index.get(this.cellKey(nc, nr))
          if (other !== undefined) {
            if (other > i && this.edgeSpan(sample, nodes[other])) {
              nbrs[i].push(other)
              nbrs[other].push(i)
            }
            break
          }
          const mid = this.sampleAt(nc, nr)
          if (mid !== null && mid.hit) {
            break
          }
        }
      }
    }
    const face = this.faceCamera(normal, nodes[0].position)
    const used = new Set<string>()
    const starts: number[] = []
    for (let i = 0; i < nodes.length; i++) {
      if (nbrs[i].length <= 1) {
        starts.push(i)
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      starts.push(i)
    }
    let drew = false
    for (let s = 0; s < starts.length; s++) {
      const start = starts[s]
      const first = this.unusedNeighbor(start, nbrs, used)
      if (first < 0) {
        continue
      }
      const chain: vec3[] = [nodes[start].position]
      let prev = start
      let cur = first
      used.add(this.edgeKey(prev, cur))
      chain.push(nodes[cur].position)
      let closed = false
      for (let guard = 0; guard < 800; guard++) {
        const nxt = this.bestContinuation(nodes, prev, cur, nbrs, used)
        if (nxt < 0) {
          break
        }
        used.add(this.edgeKey(cur, nxt))
        if (nxt === start) {
          closed = true
          break
        }
        chain.push(nodes[nxt].position)
        prev = cur
        cur = nxt
      }
      if (this.emitBoundary(chain, face, closed)) {
        drew = true
      }
    }
    return drew
  }

  private isPatchEdge(sample: SurfSample, id: number, label: Map<string, number>): boolean {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (let d = 0; d < dirs.length; d++) {
      let found = false
      for (let step = 1; step <= 2; step++) {
        const nb = this.sampleAt(sample.c + dirs[d][0] * step, sample.r + dirs[d][1] * step)
        if (nb === null) {
          continue
        }
        found = true
        if (!nb.hit || label.get(this.cellKey(nb.c, nb.r)) !== id) {
          return true
        }
        break
      }
      if (!found) {
        return true
      }
    }
    return false
  }

  private edgeSpan(a: SurfSample, b: SurfSample): boolean {
    const delta = b.position.sub(a.position)
    const dist = delta.length
    if (dist < 0.8 || dist > 42) {
      return false
    }
    const na = a.normal.length > 0.001 ? a.normal.normalize() : new vec3(0, 1, 0)
    const nb = b.normal.length > 0.001 ? b.normal.normalize() : na
    const gap = Math.max(Math.abs(delta.dot(na)), Math.abs(delta.dot(nb)))
    return gap < 8
  }

  private emitBoundary(chain: vec3[], face: vec3, closed: boolean): boolean {
    const clean: vec3[] = []
    for (let i = 0; i < chain.length; i++) {
      if (clean.length === 0 || clean[clean.length - 1].sub(chain[i]).length > 1.2) {
        clean.push(chain[i])
      }
    }
    if (clean.length < 2) {
      return false
    }
    const gap = clean[clean.length - 1].sub(clean[0]).length
    const close = closed || (clean.length >= 4 && gap < 30)
    const open: vec3[] = []
    for (let i = 0; i < clean.length; i++) {
      open.push(clean[i])
    }
    if (close) {
      open.push(clean[0])
    }
    const reduced = open.length >= 3 ? this.rdp(open, 6) : open
    if (close && reduced.length > 1 && reduced[0].sub(reduced[reduced.length - 1]).length < 1.4) {
      reduced.pop()
    }
    if (reduced.length < 2) {
      return false
    }
    const count = close ? reduced.length : reduced.length - 1
    let perimeter = 0
    let long = 0
    for (let i = 0; i < count; i++) {
      const len = reduced[(i + 1) % reduced.length].sub(reduced[i]).length
      perimeter += len
      if (len > long) {
        long = len
      }
    }
    if (perimeter < 16 || long < 12 || long > 190) {
      return false
    }
    let kept = 0
    for (let i = 0; i < count; i++) {
      const a = reduced[i]
      const b = reduced[(i + 1) % reduced.length]
      if (b.sub(a).length < 4) {
        continue
      }
      this.addStroke(a, b, face)
      kept++
    }
    return kept > 0
  }

  private hull2(pts: {x: number; y: number}[]): {x: number; y: number}[] {
    const sorted: {x: number; y: number}[] = []
    for (let i = 0; i < pts.length; i++) {
      sorted.push(pts[i])
    }
    sorted.sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x))
    const uniq: {x: number; y: number}[] = []
    for (let i = 0; i < sorted.length; i++) {
      const last = uniq.length > 0 ? uniq[uniq.length - 1] : null
      if (last === null || Math.abs(last.x - sorted[i].x) > 0.15 || Math.abs(last.y - sorted[i].y) > 0.15) {
        uniq.push(sorted[i])
      }
    }
    if (uniq.length <= 2) {
      return uniq
    }
    const turn = (o: {x: number; y: number}, a: {x: number; y: number}, b: {x: number; y: number}): number => {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }
    const lower: {x: number; y: number}[] = []
    for (let i = 0; i < uniq.length; i++) {
      while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], uniq[i]) <= 0) {
        lower.pop()
      }
      lower.push(uniq[i])
    }
    const upper: {x: number; y: number}[] = []
    for (let i = uniq.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], uniq[i]) <= 0) {
        upper.pop()
      }
      upper.push(uniq[i])
    }
    lower.pop()
    upper.pop()
    const hull: {x: number; y: number}[] = []
    for (let i = 0; i < lower.length; i++) {
      hull.push(lower[i])
    }
    for (let i = 0; i < upper.length; i++) {
      hull.push(upper[i])
    }
    return hull
  }

  private isContour(sample: SurfSample): boolean {
    const around = [
      this.sampleAt(sample.c - 1, sample.r),
      this.sampleAt(sample.c + 1, sample.r),
      this.sampleAt(sample.c, sample.r - 1),
      this.sampleAt(sample.c, sample.r + 1),
    ]
    let support = 0
    let broke = 0
    for (let i = 0; i < around.length; i++) {
      const neighbor = around[i]
      if (neighbor === null || !neighbor.hit) {
        continue
      }
      if (this.breaks(sample, neighbor)) {
        broke++
      } else {
        support++
      }
    }
    return support > 0 && broke > 0
  }

  /**
   * Drop the hit that sits on the wall behind an edge.
   * The nearer hit stays, so the stroke lies on the object.
   */
  private isOuterEdge(sample: SurfSample, ridge: Set<string>): boolean {
    const here = sample.position.sub(this.captureCam).length
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (let i = 0; i < steps.length; i++) {
      const neighbor = this.sampleAt(sample.c + steps[i][0], sample.r + steps[i][1])
      if (neighbor === null || !neighbor.hit || !this.breaks(sample, neighbor)) {
        continue
      }
      if (!ridge.has(this.cellKey(neighbor.c, neighbor.r))) {
        continue
      }
      const there = neighbor.position.sub(this.captureCam).length
      if (here > there + 3) {
        return false
      }
    }
    return true
  }

  /** Nearby edge hits on the same surface, including a diagonal step. Not a jump onto the wall. */
  private canJoin(a: SurfSample, b: SurfSample): boolean {
    const delta = b.position.sub(a.position)
    const dist = delta.length
    if (dist < 0.8 || dist > 22) {
      return false
    }
    const na = a.normal.length > 0.001 ? a.normal.normalize() : vec3.up()
    const nb = b.normal.length > 0.001 ? b.normal.normalize() : vec3.up()
    const gap = Math.max(Math.abs(delta.dot(na)), Math.abs(delta.dot(nb)))
    return gap < 9
  }

  private unusedNeighbor(cur: number, nbrs: number[][], used: Set<string>): number {
    const list = nbrs[cur]
    for (let i = 0; i < list.length; i++) {
      if (!used.has(this.edgeKey(cur, list[i]))) {
        return list[i]
      }
    }
    return -1
  }

  private bestContinuation(nodes: SurfSample[], prev: number, cur: number, nbrs: number[][], used: Set<string>): number {
    const incoming = nodes[cur].position.sub(nodes[prev].position)
    const incomingLen = incoming.length || 1
    let best = -1
    let bestDot = -0.25
    const list = nbrs[cur]
    for (let i = 0; i < list.length; i++) {
      const nxt = list[i]
      if (nxt === prev || used.has(this.edgeKey(cur, nxt))) {
        continue
      }
      const step = nodes[nxt].position.sub(nodes[cur].position)
      const stepLen = step.length || 1
      const dot = incoming.dot(step) / (incomingLen * stepLen)
      if (dot > bestDot) {
        bestDot = dot
        best = nxt
      }
    }
    return best
  }

  private edgeKey(a: number, b: number): string {
    return (a < b ? a : b) + "-" + (a < b ? b : a)
  }

  /** A wall or floor is large in two directions. Shelf boards and frames are not. */
  private isBackdrop(group: SurfSample[]): boolean {
    if (group.length < 50) {
      return false
    }
    let minX = 1e9
    let minY = 1e9
    let minZ = 1e9
    let maxX = -1e9
    let maxY = -1e9
    let maxZ = -1e9
    for (let i = 0; i < group.length; i++) {
      const p = group[i].position
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.z < minZ) minZ = p.z
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
      if (p.z > maxZ) maxZ = p.z
    }
    const dx = maxX - minX
    const dy = maxY - minY
    const dz = maxZ - minZ
    const a = Math.max(dx, dy, dz)
    const c = Math.min(dx, dy, dz)
    const b = dx + dy + dz - a - c
    return b > 85 && a > 140
  }

  private traceOutlines(id: number, group: SurfSample[], label: Map<string, number>): number {
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = 0; i < group.length; i++) {
      nx += group[i].normal.x
      ny += group[i].normal.y
      nz += group[i].normal.z
    }
    const face = new vec3(nx, ny, nz)
    const used = new Set<string>()
    let loops = 0
    const starts: SurfSample[] = []
    for (let i = 0; i < group.length; i++) {
      if (this.isBoundary(group[i], id, label)) {
        starts.push(group[i])
      }
    }
    starts.sort((p, q) => (p.r === q.r ? p.c - q.c : p.r - q.r))
    for (let i = 0; i < starts.length; i++) {
      const key = this.cellKey(starts[i].c, starts[i].r)
      if (used.has(key)) {
        continue
      }
      const loop = this.walkBoundary(starts[i], id, label, used)
      if (this.emitOutline(loop, face)) {
        loops++
      }
    }
    return loops
  }

  private isBoundary(sample: SurfSample, id: number, label: Map<string, number>): boolean {
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (let i = 0; i < steps.length; i++) {
      if (!this.inPatch(sample.c + steps[i][0], sample.r + steps[i][1], id, label)) {
        return true
      }
    }
    return false
  }

  private inPatch(c: number, r: number, id: number, label: Map<string, number>): boolean {
    const sample = this.sampleAt(c, r)
    if (sample === null || !sample.hit) {
      return false
    }
    return label.get(this.cellKey(c, r)) === id
  }

  /** Clockwise walk around one face. Diagonal steps are allowed, so a tilted edge stays tilted. */
  private walkBoundary(start: SurfSample, id: number, label: Map<string, number>, used: Set<string>): vec3[] {
    const dc = [1, 1, 0, -1, -1, -1, 0, 1]
    const dr = [0, 1, 1, 1, 0, -1, -1, -1]
    let c = start.c
    let r = start.r
    let dir = 0
    for (let i = 0; i < 8; i++) {
      if (!this.inPatch(c + dc[i], r + dr[i], id, label)) {
        dir = i
        break
      }
    }
    const pts: vec3[] = []
    const guard = new Set<string>()
    for (let step = 0; step < 700; step++) {
      const token = c + "," + r + "@" + dir
      if (guard.has(token)) {
        break
      }
      guard.add(token)
      used.add(this.cellKey(c, r))
      const sample = this.sampleAt(c, r)
      if (sample !== null && sample.hit) {
        pts.push(this.lipPoint(sample, id, label))
      }
      let next = -1
      for (let k = 1; k <= 8; k++) {
        const nd = (dir + k) % 8
        if (this.inPatch(c + dc[nd], r + dr[nd], id, label)) {
          next = nd
          break
        }
      }
      if (next < 0) {
        break
      }
      const nc = c + dc[next]
      const nr = r + dr[next]
      if (nc === start.c && nr === start.r && pts.length > 6) {
        break
      }
      dir = (next + 5) % 8
      c = nc
      r = nr
    }
    return pts
  }

  /** Stay on the object's plane, pulled a few centimeters toward the lip. */
  private lipPoint(sample: SurfSample, id: number, label: Map<string, number>): vec3 {
    const n = sample.normal.length > 0.001 ? sample.normal.normalize() : vec3.up()
    let outside: SurfSample | null = null
    let best = 0
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]
    for (let i = 0; i < steps.length; i++) {
      const nb = this.sampleAt(sample.c + steps[i][0], sample.r + steps[i][1])
      if (nb === null || !nb.hit || label.get(this.cellKey(nb.c, nb.r)) === id) {
        continue
      }
      const score = this.separation(sample, nb)
      if (score >= best) {
        best = score
        outside = nb
      }
    }
    if (outside === null) {
      return sample.position
    }
    const delta = outside.position.sub(sample.position)
    const along = delta.sub(n.uniformScale(delta.dot(n)))
    if (along.length < 0.3) {
      return sample.position
    }
    return sample.position.add(along.normalize().uniformScale(Math.min(3.5, along.length * 0.5)))
  }

  private separation(a: SurfSample, b: SurfSample): number {
    const delta = b.position.sub(a.position)
    const na = a.normal.length > 0.001 ? a.normal.normalize() : vec3.up()
    const nb = b.normal.length > 0.001 ? b.normal.normalize() : vec3.up()
    const gap = Math.max(Math.abs(delta.dot(na)), Math.abs(delta.dot(nb)))
    return gap + (1 - Math.abs(na.dot(nb))) * 30
  }

  private emitOutline(loop: vec3[], face: vec3): boolean {
    const simplified = this.simplifyLoop(loop)
    if (simplified.length < 3) {
      return false
    }
    let perimeter = 0
    for (let i = 0; i < simplified.length; i++) {
      const nxt = simplified[(i + 1) % simplified.length]
      perimeter += nxt.sub(simplified[i]).length
    }
    if (perimeter < 22) {
      return false
    }
    const gap = simplified[0].sub(simplified[simplified.length - 1]).length
    const close = gap < 18
    const count = close ? simplified.length : simplified.length - 1
    let kept = 0
    for (let i = 0; i < count; i++) {
      const a = simplified[i]
      const b = simplified[(i + 1) % simplified.length]
      if (b.sub(a).length < 4) {
        continue
      }
      const mid = a.add(b).uniformScale(0.5)
      this.addStroke(a, b, this.faceCamera(face, mid))
      kept++
    }
    return kept > 0
  }

  private simplifyLoop(loop: vec3[]): vec3[] {
    const clean: vec3[] = []
    for (let i = 0; i < loop.length; i++) {
      if (clean.length === 0 || clean[clean.length - 1].sub(loop[i]).length > 1.4) {
        clean.push(loop[i])
      }
    }
    if (clean.length > 2 && clean[0].sub(clean[clean.length - 1]).length < 1.4) {
      clean.pop()
    }
    if (clean.length < 3) {
      return clean
    }
    const open: vec3[] = []
    for (let i = 0; i < clean.length; i++) {
      open.push(clean[i])
    }
    open.push(clean[0])
    const reduced = this.rdp(open, 4.2)
    if (reduced.length > 1 && reduced[0].sub(reduced[reduced.length - 1]).length < 1.4) {
      reduced.pop()
    }
    return reduced
  }

  private rdp(pts: vec3[], eps: number): vec3[] {
    if (pts.length < 3) {
      return pts
    }
    let maxD = 0
    let idx = 0
    const a = pts[0]
    const b = pts[pts.length - 1]
    for (let i = 1; i < pts.length - 1; i++) {
      const d = this.distToSeg(pts[i], a, b)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD <= eps) {
      return [a, b]
    }
    const left = this.rdp(pts.slice(0, idx + 1), eps)
    const right = this.rdp(pts.slice(idx), eps)
    const merged: vec3[] = []
    for (let i = 0; i < left.length - 1; i++) {
      merged.push(left[i])
    }
    for (let i = 0; i < right.length; i++) {
      merged.push(right[i])
    }
    return merged
  }

  private distToSeg(point: vec3, a: vec3, b: vec3): number {
    const ab = b.sub(a)
    const len2 = ab.dot(ab)
    if (len2 < 0.01) {
      return point.sub(a).length
    }
    let t = point.sub(a).dot(ab) / len2
    if (t < 0) t = 0
    else if (t > 1) t = 1
    return point.sub(a.add(ab.uniformScale(t))).length
  }

  private emitChain(chain: vec3[], face: vec3, closed: boolean): boolean {
    const simplified = this.simplifyChain(chain)
    if (simplified.length < 2) {
      return false
    }
    let perimeter = 0
    for (let i = 0; i < simplified.length - 1; i++) {
      perimeter += simplified[i + 1].sub(simplified[i]).length
    }
    const gap = simplified[simplified.length - 1].sub(simplified[0]).length
    const close = closed || (simplified.length >= 4 && gap < 26)
    if (close) {
      perimeter += gap
    }
    if (perimeter < 12) {
      return false
    }
    const count = close ? simplified.length : simplified.length - 1
    let kept = 0
    for (let i = 0; i < count; i++) {
      const a = simplified[i]
      const b = simplified[(i + 1) % simplified.length]
      if (b.sub(a).length < 3.5) {
        continue
      }
      this.addStroke(a, b, this.faceCamera(face, a.add(b).uniformScale(0.5)))
      kept++
    }
    return kept > 0
  }

  private simplifyChain(chain: vec3[]): vec3[] {
    const clean: vec3[] = []
    for (let i = 0; i < chain.length; i++) {
      if (clean.length === 0 || clean[clean.length - 1].sub(chain[i]).length > 1.2) {
        clean.push(chain[i])
      }
    }
    if (clean.length < 3) {
      return clean
    }
    return this.rdp(clean, 5)
  }

  private faceCamera(normal: vec3, mid: vec3): vec3 {
    let n = normal.length > 0.001 ? normal.normalize() : vec3.up()
    if (n.dot(this.captureCam.sub(mid)) < 0) {
      n = n.uniformScale(-1)
    }
    return n
  }

  private breaks(a: SurfSample, b: SurfSample): boolean {
    const delta = b.position.sub(a.position)
    const dist = delta.length
    if (dist < 0.4) {
      return false
    }
    if (dist > 36) {
      return true
    }
    const na = a.normal.length > 0.001 ? a.normal.normalize() : vec3.up()
    const nb = b.normal.length > 0.001 ? b.normal.normalize() : vec3.up()
    const gap = Math.max(Math.abs(delta.dot(na)), Math.abs(delta.dot(nb)))
    return gap > PLANE_GAP || Math.abs(na.dot(nb)) < NORMAL_DOT
  }

  private addStroke(a: vec3, b: vec3, normal: vec3, dim?: boolean, objectId?: number, owner?: string): void {
    if (this.cells.size >= this.maxCells) {
      return
    }
    let endA = a
    let endB = b
    if (endB.x < endA.x || (endB.x === endA.x && endB.y < endA.y) || (endB.x === endA.x && endB.y === endA.y && endB.z < endA.z)) {
      const swap = endA
      endA = endB
      endB = swap
    }
    const mid = endA.add(endB).uniformScale(0.5)
    const edge = endB.sub(endA)
    const len = edge.length || 1
    const group = objectId && objectId > 0 ? objectId : 0
    let key =
      Math.round(mid.x) +
      "," +
      Math.round(mid.y) +
      "," +
      Math.round(mid.z) +
      "|" +
      Math.round((edge.x / len) * 4) +
      "," +
      Math.round((edge.y / len) * 4) +
      "," +
      Math.round((edge.z / len) * 4)
    if (group > 0) {
      key = key + "|o" + group
    }
    if (owner) {
      key = key + "|w" + owner
    }
    if (this.blocked.has(key) || this.cells.has(key)) {
      return
    }
    this.cells.set(key, {
      key: key,
      position: mid,
      normal: normal,
      endA: endA,
      endB: endB,
      dim: dim === true,
      objectId: group > 0 ? group : undefined,
      owner: owner,
    })
  }

  /**
   * Nearby preview depth hits include vertical sheets in the open air.
   * Flat surfaces (tables, floors, seats) stay at any distance. Farther
   * walls stay too. Device hits are kept.
   */
  private editorCurtain(position: vec3, normal: vec3, cameraPos: vec3): boolean {
    if (!global.deviceInfoSystem.isEditor()) {
      return false
    }
    if (Math.abs(normal.y) >= 0.85) {
      return false
    }
    return position.sub(cameraPos).length < 80
  }

  /**
   * The preview depth shell sits slightly in front of the rendered room.
   * On device the hit is already the surface, so this push is editor-only.
   */
  private seatOnSurface(position: vec3, cameraPos: vec3): vec3 {
    if (!global.deviceInfoSystem.isEditor()) {
      return position
    }
    const away = position.sub(cameraPos)
    const dist = away.length
    if (dist < 20) {
      return position
    }
    const push = dist * 0.1
    if (push >= dist - 6) {
      return position
    }
    return position.add(away.uniformScale(0.1))
  }

  private deviceTracking(camera: Camera): DeviceTracking | null {
    if (!this.trackingLooked) {
      this.trackingLooked = true
      this.tracking = camera.getSceneObject().getComponent("Component.DeviceTracking") as DeviceTracking
      if (this.tracking) {
        try {
          this.tracking.worldOptions.enableWorldMeshesTracking = true
          print("[SpaceClip] world mesh tracking enabled")
        } catch (err) {
          print("[SpaceClip] world mesh tracking left off. " + err)
        }
      }
    }
    return this.tracking
  }

  /** Reject hits that are not on the ray we cast. Those draw as floating squares. */
  private hitLiesOnRay(start: vec3, end: vec3, position: vec3): boolean {
    const seg = end.sub(start)
    const len = seg.length
    if (len < 1) {
      return false
    }
    const dir = seg.uniformScale(1 / len)
    const t = position.sub(start).dot(dir)
    if (t < 5 || t > len + 8) {
      return false
    }
    const closest = start.add(dir.uniformScale(t))
    return position.sub(closest).length < 35
  }

  private buildStandIn(camera: Camera): void {
    if (this.standInBuilt || !this.standInRoot) {
      return
    }
    this.standInBuilt = true
    const cam = camera.getTransform()
    const eye = cam.getWorldPosition()
    let flat = new vec3(cam.back.x, 0, cam.back.z)
    if (flat.length < 0.01) {
      flat = new vec3(0, 0, 1)
    } else {
      flat = flat.normalize()
    }
    const root = this.standInRoot.getTransform()
    root.setWorldPosition(new vec3(eye.x, eye.y - this.eyeHeightCm, eye.z))
    root.setWorldRotation(quat.lookAt(flat, vec3.up()))

    const roomMat = ROOM_MAT.clone()
    roomMat.mainPass.baseColor = new vec4(0.55, 0.68, 0.82, 1)
    roomMat.mainPass.twoSided = true

    const blocks: {name: string; pos: vec3; size: vec3}[] = [
      {name: "StandInFloor", pos: new vec3(0, -2, 0), size: new vec3(520, 4, 520)},
      {name: "StandInWallFront", pos: new vec3(0, 140, 250), size: new vec3(520, 280, 8)},
      {name: "StandInWallBack", pos: new vec3(0, 140, -250), size: new vec3(520, 280, 8)},
      {name: "StandInWallLeft", pos: new vec3(-250, 140, 0), size: new vec3(8, 280, 520)},
      {name: "StandInWallRight", pos: new vec3(250, 140, 0), size: new vec3(8, 280, 520)},
      {name: "StandInBlockA", pos: new vec3(-90, 38, 110), size: new vec3(180, 76, 84)},
      {name: "StandInBlockB", pos: new vec3(50, 28, 180), size: new vec3(120, 56, 70)},
      {name: "StandInBlockC", pos: new vec3(130, 25, 80), size: new vec3(48, 50, 48)},
    ]
    for (let i = 0; i < blocks.length; i++) {
      this.addBlock(blocks[i].name, blocks[i].pos, blocks[i].size, roomMat)
    }
    print("[SpaceClip] PreviewRoomStandIn built around the camera")
  }

  private addBlock(name: string, localPos: vec3, size: vec3, material: Material): void {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.standInRoot)
    obj.getTransform().setLocalPosition(localPos)
    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = buildBoxMesh(size.x, size.y, size.z)
    visual.mainMaterial = material
    const body = obj.createComponent("Physics.BodyComponent") as BodyComponent
    body.dynamic = false
    const shape = Shape.createBoxShape()
    shape.size = size
    body.shape = shape
  }
}

function facingNormal(normal: vec3, position: vec3, cameraPos: vec3): vec3 {
  let facing = normal
  if (facing.length < 0.001) {
    facing = cameraPos.sub(position)
  }
  if (facing.length < 0.001) {
    return vec3.up()
  }
  facing = facing.normalize()
  if (facing.dot(cameraPos.sub(position)) < 0) {
    facing = facing.uniformScale(-1)
  }
  return facing
}

