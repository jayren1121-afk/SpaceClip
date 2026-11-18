/**
 * SpaceClipMain — orchestration only.
 * The lens starts quiet. Clip picks the one object at the center of the view
 * and traces its outline in from bottom to top. Hover highlights one box
 * part; a click selects it. Delete removes that part, or the whole wire
 * when nothing is selected. + and − scale the selection, or the whole wire.
 * On device, two pinches scale, a flick deletes, and a palm or a left swipe undoes.
 *
 * Scene objects:
 *   SpaceClipRoot, ScanWireframe, PreviewRoomStandIn, MiniatureRig,
 *   MiniatureSpin, MiniatureModel, GrabbedChunk, Sparkles, SpaceClipControls
 *
 * Tester state is written every frame to debugState:
 *   phase|source|cells|highlight|selected|undo|saves|shelf|name
 */

import {SpaceClipControlsUI, ShelfCardView} from "./SpaceClipControlsUI"
import {gestureSelfCheck, SpaceClipGestures} from "./SpaceClipGestures"
import {SpaceClipInput} from "./SpaceClipInput"
import {SpaceClipMiniatureController} from "./SpaceClipMiniatureController"
import {SpaceClipScanController} from "./SpaceClipScanController"
import {ShelfFile, loadShelf, pushSave, storeShelf} from "./SpaceClipState"
import {WireCell} from "./SpaceClipTypes"

@component
export class SpaceClipMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SpaceClipMain – life-size wireframe</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Specs camera with world device tracking.")
  camera: Camera

  @input
  @hint("Life-size wireframe drawn by Clip.")
  scan: SpaceClipScanController

  @input
  @hint("Highlight, selection, sparkles, and undo for the life-size wireframe.")
  miniature: SpaceClipMiniatureController

  @input
  @hint("Clip, Undo, Delete, Save, and the saved-chunk cards.")
  controls: SpaceClipControlsUI
  @ui.group_end

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("How far in front of the view the button row is locked, in centimeters.")
  @widget(new SliderWidget(40, 70, 1))
  followDistanceCm: number = 50

  @input
  @hint("How far below the view center the button row is locked, in centimeters.")
  @widget(new SliderWidget(12, 32, 1))
  followDropCm: number = 22

  @input
  @hint("Seconds the shelf stays up before the buttons come back.")
  @widget(new SliderWidget(2, 10, 0.5))
  shelfSeconds: number = 5

  @input
  @hint("Draw stand-in room colliders when the fallback room is in use.")
  debugColliders: boolean = false
  @ui.group_end

  @ui.separator
  @ui.group_start("Debug")
  @input
  @hint("Live tester string. Updated every frame. Do not edit.")
  debugState: string = "phase=idle"
  @ui.group_end

  private pointer = new SpaceClipInput()
  private gestures = new SpaceClipGestures()
  private scaleBase: WireCell[] | null = null
  private shelf: ShelfFile = {nextNumber: 1, saves: []}
  private phase: "idle" | "capturing" | "editing" = "idle"
  private shelfShownAt = -1
  private openName = ""
  private ready = false
  private capturedOnce = false
  private debugDrawn = false
  private lastButtonName = ""
  private lastButtonAt = -1
  private ctrlHeld = false
  /** Button the current pinch went down on. A release elsewhere is not a press. */
  private pressedUi = ""

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    this.createEvent("LateUpdateEvent").bind(() => this.onLate())
    if (isNull(this.camera) || isNull(this.scan) || isNull(this.miniature) || isNull(this.controls)) {
      print("[SpaceClip] missing reference on SpaceClipMain")
      return
    }
    this.ready = true
    this.shelf = loadShelf()
  }

  private onStart(): void {
    if (!this.ready) {
      return
    }
    this.controls.onClip.add(() => this.onClip("button"))
    this.controls.onUndo.add(() => this.onUndo())
    this.controls.onDelete.add(() => this.onDelete())
    this.controls.onSave.add(() => this.onSave())
    this.controls.onPlus.add(() => this.onPlus())
    this.controls.onMinus.add(() => this.onMinus())
    this.controls.onOpenCard.add((index: number) => this.onOpenCard(index))
    this.controls.showClipOnly()
    gestureSelfCheck()
    const keys = this.createEvent("KeyPressEvent") as KeyPressEvent
    keys.bind((event) => this.onKey(event, true))
    const up = this.createEvent("KeyReleaseEvent") as KeyReleaseEvent
    up.bind((event) => this.onKey(event, false))
    print("[SpaceClip] ready")
  }

  private onKey(event: {key: Keys; modifiers: KeyModifiers[]}, pressed: boolean): void {
    const code = event.key as number
    if (code === 16777249) {
      this.ctrlHeld = pressed
      return
    }
    if (!pressed) {
      return
    }
    const name = Keys[code] ? Keys[code] : "code" + code
    print("[SpaceClip] key " + name + " (" + code + ") selected=" + this.selectionLabel())
    // The preview sends Qt key codes. Delete is 16777223, Backspace is 16777219.
    if (code === 16777223 || code === 16777219 || code === (Keys.Backspace as number)) {
      this.onDelete()
      return
    }
    if (this.ctrlHeld && (code === 90 || code === (Keys.Z as number))) {
      this.onUndo()
      return
    }
    // +/= grow, - shrinks. Qt: Plus 43, Equal 61, Minus 45.
    if (code === 45) {
      this.onMinus()
    } else if (code === 43 || code === 61) {
      this.onPlus()
    }
  }

  private onUpdate(): void {
    if (!this.ready) {
      return
    }
    if (this.scan.isCapturing()) {
      this.scan.fireRays(this.camera, getDeltaTime())
    }
    if (this.phase === "capturing" && !this.scan.isCapturing()) {
      this.phase = "editing"
      this.capturedOnce = true
      this.applyButtons()
    }
  }

  private onLate(): void {
    if (!this.ready) {
      return
    }
    const dt = getDeltaTime()
    this.placeControls()
    const sample = this.pointer.sample(this.camera)
    const uiName = this.uiButton(sample)
    // Only our row test counts. The plate's interactable can cover the whole view
    // and would otherwise swallow a tap that missed every button.
    sample.onUi = uiName !== ""
    const tapKind = sample.pinchDown ? "down" : sample.pinchUp ? "up" : ""
    const selectedBefore = tapKind !== "" ? this.selectionLabel() : ""
    const piece = tapKind !== "" ? this.miniature.pieceUnder(this.scan, sample) : ""
    const rayHit = tapKind !== "" && sample.hasRay ? this.controls.describeRay(sample.origin, sample.direction) : ""
    const hands = this.gestures.sample(this.camera)
    if (hands.enabled && this.phase !== "capturing" && !this.scan.isForming()) {
      this.applyGestures(hands)
      if (hands.scaling || hands.flick) {
        sample.pinching = false
        sample.pinchDown = false
        sample.pinchUp = false
      }
    }
    this.scan.tickForm()
    this.miniature.tick(this.scan, sample, dt)
    if (sample.pinchDown) {
      this.pressedUi = uiName
    }
    if (sample.pinchUp) {
      const source = sample.hasPoint && !sample.hasRay ? "pinch" : "button"
      if (uiName !== "" && uiName !== "row" && this.pressedUi === uiName) {
        this.pressButton(uiName, source)
      }
      this.pressedUi = ""
    }
    if (tapKind !== "") {
      const hit = uiName !== "" ? uiName : piece
      print(
        "[SpaceClip] tap " +
          tapKind +
          " hit=" +
          hit +
          " ray=" +
          rayHit +
          " interactable=" +
          this.pointer.interactableName() +
          " selected " +
          selectedBefore +
          " -> " +
          this.selectionLabel()
      )
    }
    this.scan.rebuildIfDirty()
    this.syncControls()
    if (this.debugColliders && !this.debugDrawn && this.scan.sourceName() === "standin") {
      this.setColliderDebugAll(this.sceneObject, true)
      this.debugDrawn = true
    }
    this.debugState = this.composeDebug()
  }

  private syncControls(): void {
    if (this.shelfShownAt >= 0 && getTime() - this.shelfShownAt >= this.shelfSeconds) {
      this.shelfShownAt = -1
      this.applyButtons()
      print("[SpaceClip] shelf hidden")
      return
    }
    if (this.shelfShownAt >= 0) {
      return
    }
    this.applyButtons()
  }

  private applyButtons(): void {
    if (this.shelfShownAt >= 0) {
      return
    }
    if (!this.capturedOnce || this.phase === "capturing") {
      this.controls.showClipOnly()
      return
    }
    this.controls.showEdit(this.scan.cellCount() > 0)
  }

  private uiButton(sample: {hasRay: boolean; hasPoint: boolean; origin: vec3; direction: vec3; world: vec3}): string {
    if (sample.hasRay && sample.direction.length > 0.001) {
      return this.controls.buttonUnderRay(sample.origin, sample.direction)
    }
    if (sample.hasPoint) {
      return this.controls.buttonUnderPoint(sample.world)
    }
    return ""
  }

  private pressButton(name: string, source: string): void {
    if (name === "Clip") {
      this.onClip(source)
    } else if (name === "Undo") {
      this.onUndo()
    } else if (name === "Delete") {
      this.onDelete()
    } else if (name === "Save") {
      this.onSave()
    } else if (name === "+") {
      this.onPlus()
    } else if (name === "−") {
      this.onMinus()
    }
  }

  private applyGestures(hands: {
    scaling: boolean
    scaleJustStarted: boolean
    scaleJustEnded: boolean
    scaleFactor: number
    flick: boolean
    flickPoint: vec3
    undo: boolean
    undoReason: string
  }): void {
    if (this.scan.cellCount() === 0) {
      this.scaleBase = null
      return
    }
    if (hands.scaleJustStarted) {
      this.scaleBase = this.scaleTargets()
      print("[SpaceClip] gesture scale start, selected=" + this.selectionLabel())
    }
    if (hands.scaling && this.scaleBase !== null) {
      this.scan.scaleFrom(this.scaleBase, hands.scaleFactor)
      this.miniature.refreshLines(this.scan)
    }
    if (hands.scaleJustEnded && this.scaleBase !== null) {
      if (Math.abs(hands.scaleFactor - 1) > 0.04) {
        this.miniature.remember(this.scaleBase)
      }
      print("[SpaceClip] gesture scale " + hands.scaleFactor.toFixed(2) + ", selected=" + this.selectionLabel())
      this.scaleBase = null
      this.miniature.refreshLines(this.scan)
    }
    if (hands.flick && this.miniature.hasSelection()) {
      const cells = this.miniature.selectedCells()
      let sum = vec3.zero()
      for (let i = 0; i < cells.length; i++) {
        sum = sum.add(cells[i].position)
      }
      const center = sum.uniformScale(1 / Math.max(1, cells.length))
      if (hands.flickPoint.sub(center).length < 45) {
        print("[SpaceClip] gesture flick, selected=" + this.selectionLabel())
        this.onDelete()
      }
    }
    if (hands.undo) {
      print("[SpaceClip] gesture undo " + hands.undoReason)
      this.onUndo()
    }
  }

  private scaleTargets(): WireCell[] {
    const source = this.miniature.hasSelection() ? this.miniature.selectedCells() : this.scan.getCells()
    const out: WireCell[] = []
    for (let i = 0; i < source.length; i++) {
      const cell = source[i]
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

  private scaleBy(factor: number): void {
    if (this.phase === "capturing" || this.scan.cellCount() === 0) {
      return
    }
    const base = this.scaleTargets()
    const before = this.wireSpan(base)
    this.scan.scaleFrom(base, factor)
    const after = this.wireSpan(this.scan.getCells())
    this.miniature.remember(base)
    this.miniature.refreshLines(this.scan)
    this.scan.rebuildIfDirty()
    print("[SpaceClip] scaled x" + factor.toFixed(2) + " span " + before.toFixed(1) + " -> " + after.toFixed(1))
  }

  private wireSpan(cells: WireCell[]): number {
    if (cells.length === 0) {
      return 0
    }
    let minX = cells[0].position.x
    let minY = cells[0].position.y
    let minZ = cells[0].position.z
    let maxX = minX
    let maxY = minY
    let maxZ = minZ
    for (let i = 1; i < cells.length; i++) {
      const p = cells[i].position
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      minZ = Math.min(minZ, p.z)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      maxZ = Math.max(maxZ, p.z)
    }
    return Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY) + (maxZ - minZ) * (maxZ - minZ))
  }

  private onPlus(): void {
    if (!this.acceptButton("+")) {
      return
    }
    print("[SpaceClip] + pressed, selected=" + this.selectionLabel())
    this.scaleBy(1.2)
  }

  private onMinus(): void {
    if (!this.acceptButton("−")) {
      return
    }
    print("[SpaceClip] − pressed, selected=" + this.selectionLabel())
    this.scaleBy(1 / 1.2)
  }

  private acceptButton(name: string): boolean {
    const now = getTime()
    if (name === this.lastButtonName && now - this.lastButtonAt < 0.25) {
      return false
    }
    this.lastButtonName = name
    this.lastButtonAt = now
    return true
  }

  private selectionLabel(): string {
    const id = this.miniature.selectedPartId()
    if (id < 0) {
      return "none"
    }
    return this.scan.partLabel(id)
  }

  private onClip(source: string): void {
    if (this.scan.isForming()) {
      return
    }
    if (!this.acceptButton("Clip")) {
      return
    }
    print("[SpaceClip] clip triggered by " + source)
    print("[SpaceClip] Clip pressed, selected=" + this.selectionLabel())
    this.shelfShownAt = -1
    this.phase = "capturing"
    this.capturedOnce = false
    this.openName = ""
    const replaced = this.scan.beginCapture(this.camera)
    if (replaced !== "") {
      this.miniature.clearOwner(this.scan, replaced)
    }
    this.controls.showClipOnly()
  }

  private onUndo(): void {
    if (!this.acceptButton("Undo")) {
      return
    }
    print("[SpaceClip] Undo pressed, selected=" + this.selectionLabel())
    if (!this.capturedOnce || this.phase === "capturing") {
      return
    }
    this.miniature.undo(this.scan)
    this.scan.rebuildIfDirty()
  }

  private onDelete(): void {
    if (!this.acceptButton("Delete")) {
      return
    }
    print("[SpaceClip] Delete pressed, selected=" + this.selectionLabel())
    if (this.phase === "capturing" || this.scan.cellCount() === 0) {
      return
    }
    if (this.miniature.hasSelection()) {
      this.miniature.deleteSelected(this.scan)
    } else {
      this.miniature.deleteAll(this.scan)
    }
    this.scan.rebuildIfDirty()
    this.applyButtons()
  }

  private onSave(): void {
    if (!this.acceptButton("Save")) {
      return
    }
    print("[SpaceClip] Save pressed, selected=" + this.selectionLabel())
    if (!this.capturedOnce || this.phase === "capturing" || this.scan.cellCount() === 0) {
      return
    }
    const saved = pushSave(this.shelf, {cells: this.scan.storedCells(), removed: []})
    storeShelf(this.shelf)
    this.openName = saved.name
    this.miniature.clearSelection(this.scan)
    this.scan.rebuildIfDirty()
    this.controls.showShelf(this.cardViews())
    this.shelfShownAt = getTime()
    print("[SpaceClip] saved " + saved.name)
  }

  private onOpenCard(index: number): void {
    const space = this.shelf.saves[index]
    if (!space) {
      return
    }
    this.miniature.restoreChunk(this.scan, space)
    this.scan.rebuildIfDirty()
    this.openName = space.name
    this.shelfShownAt = -1
    this.applyButtons()
    print("[SpaceClip] opened " + space.name)
  }

  private placeControls(): void {
    this.followDistanceCm = 50
    const cam = this.camera.getTransform()
    const root = this.controls.getSceneObject()
    if (root.getParent() !== null) {
      root.setParent(null)
    }
    const eye = cam.getWorldPosition()
    const planePoint = eye.add(cam.back.uniformScale(this.followDistanceCm))
    const centerUv = this.camera.worldSpaceToScreenSpace(planePoint)
    const probe = planePoint.add(cam.up.uniformScale(-10))
    const probeUv = this.camera.worldSpaceToScreenSpace(probe)
    const perCm = (probeUv.y - centerUv.y) / 10
    let drop = 10
    if (Math.abs(perCm) > 0.0001) {
      // Center the row so its body sits about 18% above the bottom edge.
      drop = (0.80 - centerUv.y) / perCm
    }
    if (drop < 4) {
      drop = 4
    } else if (drop > 20) {
      drop = 20
    }
    this.followDropCm = drop
    const pos = planePoint.add(cam.up.uniformScale(-drop))
    const tr = root.getTransform()
    tr.setWorldPosition(pos)
    const toEye = eye.sub(pos)
    if (toEye.length > 0.001) {
      tr.setWorldRotation(quat.lookAt(toEye.normalize(), cam.up))
    }
  }

  private cardViews(): ShelfCardView[] {
    const views: ShelfCardView[] = []
    for (let i = 0; i < this.shelf.saves.length && i < 3; i++) {
      views.push({name: this.shelf.saves[i].name, date: this.shelf.saves[i].date})
    }
    return views
  }

  private composeDebug(): string {
    const shelf = this.controls.isShelfShown() ? 1 : 0
    return (
      "phase=" +
      this.phase +
      "|source=" +
      this.scan.sourceName() +
      "|cells=" +
      this.scan.cellCount() +
      "|highlight=" +
      this.miniature.getHighlightedCount() +
      "|selected=" +
      this.miniature.getSelectedCount() +
      "|undo=" +
      this.miniature.getUndoCount() +
      "|saves=" +
      this.shelf.saves.length +
      "|shelf=" +
      shelf +
      "|name=" +
      this.openName
    )
  }

  private setColliderDebugAll(obj: SceneObject, enable: boolean): void {
    const collider = obj.getComponent("Physics.ColliderComponent") as ColliderComponent | null
    if (collider) {
      collider.debugDrawEnabled = enable
    }
    const body = obj.getComponent("Physics.BodyComponent") as ColliderComponent | null
    if (body) {
      body.debugDrawEnabled = enable
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.setColliderDebugAll(obj.getChild(i), enable)
    }
  }
}
