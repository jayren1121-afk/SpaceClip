/**
 * SpaceClipControlsUI — the head-locked button row.
 * Owns Clip, Undo, Delete, Save, and the saved-chunk cards.
 * Passive view: it emits taps and shows what Main asks it to show.
 * It does not decide which chunk is selected.
 *
 * Before the first capture only Clip is shown. After a capture, Undo joins.
 * Delete and Save appear only while a chunk is selected. The shelf replaces
 * the row when Main asks for it.
 */

import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

type TextRole = "Button" | "Caption"
type ShownMode = "clip" | "edit" | "selected" | "shelf"

const FONT_SIZE_SCALE = 1
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Button: {size: 34, weight: 500},
  Caption: {size: 40, weight: 500},
}
const BUTTON_LABEL_Z = 0.08
const LAYOUT_Z_LIFT = 0
const PLATE_COLOR = new vec4(0.78, 0.9, 1, 1)

/** Lens Studio 5.16+ size is an em square. This matches a line height of size/32 cm. */
function roleSize(role: TextRole): number {
  return TYPE_SCALE[role].size * 0.69492703 * (43.88571429 / 32) * FONT_SIZE_SCALE
}

function applyTextRole(text: Text, role: TextRole): void {
  text.size = roleSize(role)
  ;(text as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

export interface ShelfCardView {
  name: string
  date: string
}

interface ActionButton {
  root: SceneObject
  button: Button
  label: Text
  item: FlexItem
}

@component
export class SpaceClipControlsUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">SpaceClipControlsUI – clip, undo, delete, save</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Width of the low button row, in centimeters.")
  @widget(new SliderWidget(16, 28, 1))
  rowWidthCm: number = 22

  @input
  @hint("Height of the low button row, in centimeters.")
  @widget(new SliderWidget(3.2, 5, 0.1))
  rowHeightCm: number = 4

  @input
  @hint("Label on the clip button.")
  clipLabel: string = "Clip"

  @input
  @hint("Label on the undo button.")
  undoLabel: string = "Undo"

  @input
  @hint("Label on the delete button.")
  deleteLabel: string = "Delete"

  @input
  @hint("Label on the save button.")
  saveLabel: string = "Save"
  @ui.group_end

  /** User tapped Clip. Created in onAwake so other scripts can subscribe on Start. */
  onClip: Event<void>
  /** User tapped Undo. */
  onUndo: Event<void>
  /** User tapped Delete. */
  onDelete: Event<void>
  /** User tapped Save. */
  onSave: Event<void>
  /** User tapped +. */
  onPlus: Event<void>
  /** User tapped −. */
  onMinus: Event<void>
  /** User tapped a card. Argument is the shelf index, 0 = newest. */
  onOpenCard: Event<number>

  private built = false
  private shown: ShownMode = "clip"
  private opacity = 1
  private slot: SceneObject
  private plateObj: SceneObject
  private buttonRow: SceneObject
  private buttonLayout: FlexLayout
  private shelfRow: SceneObject
  private layoutReady = false
  private actions: ActionButton[] = []
  private cards: {root: SceneObject; button: Button; label: Text}[] = []

  onAwake(): void {
    this.onClip = new Event<void>()
    this.onUndo = new Event<void>()
    this.onDelete = new Event<void>()
    this.onSave = new Event<void>()
    this.onPlus = new Event<void>()
    this.onMinus = new Event<void>()
    this.onOpenCard = new Event<number>()
    this.build()
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart(): void {
    const wait = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    wait.bind(() => this.brightenPlate())
    wait.reset(0.15)
  }

  /** Only Clip. Used before the first capture and during a new capture. */
  showClipOnly(): void {
    if (this.shown === "clip" && this.sceneObject.enabled && this.buttonRow && this.buttonRow.enabled) {
      return
    }
    this.shown = "clip"
    this.presentButtons()
  }

  /** Clip and Undo. Delete and Save join when a chunk is selected. */
  showEdit(showDeleteSave: boolean): void {
    const next: ShownMode = showDeleteSave ? "selected" : "edit"
    if (this.shown === next && this.sceneObject.enabled && this.buttonRow && this.buttonRow.enabled) {
      return
    }
    this.shown = next
    this.presentButtons()
  }

  showShelf(cards: ShelfCardView[]): void {
    this.shown = "shelf"
    this.sceneObject.enabled = true
    this.opacity = 1
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      const data = cards[i]
      const show = !!data
      card.root.enabled = show
      if (data) {
        card.label.text = data.name + "\n" + data.date
      }
    }
    this.buttonRow.enabled = false
    this.shelfRow.enabled = true
    this.slot.enabled = true
    this.applyOpacity()
    this.setActionsLive(false)
    this.setCardsLive(true)
  }

  isShelfShown(): boolean {
    return this.shown === "shelf" && this.slot.enabled
  }

  /**
   * Button under a world ray: "Clip", "Undo", "Delete", "Save", or "row"
   * when the ray hits the plate but not a label. Empty when it misses.
   */
  /**
   * Where a ray meets the button row: "Delete", "row" (the plate, not a button),
   * or "miss", plus the local x so a miss can be compared with the button spans.
   */
  describeRay(origin: vec3, direction: vec3): string {
    if (!this.slot || !this.slot.enabled || direction.length < 0.001) {
      return "miss"
    }
    const inv = this.getTransform().getWorldTransform().inverse()
    const localOrigin = inv.multiplyPoint(origin)
    const localDir = inv.multiplyDirection(direction)
    const t = this.raySlab(localOrigin, localDir)
    if (t === null) {
      return "miss"
    }
    const x = localOrigin.x + localDir.x * t
    return this.buttonAtLocalX(x) + " x=" + x.toFixed(1)
  }

  buttonUnderRay(origin: vec3, direction: vec3): string {
    if (!this.slot || !this.slot.enabled || direction.length < 0.001) {
      return ""
    }
    const inv = this.getTransform().getWorldTransform().inverse()
    const localOrigin = inv.multiplyPoint(origin)
    const localDir = inv.multiplyDirection(direction)
    const t = this.raySlab(localOrigin, localDir)
    if (t === null) {
      return ""
    }
    return this.buttonAtLocalX(localOrigin.x + localDir.x * t)
  }

  /** Button under a world point, for a fingertip on device. */
  buttonUnderPoint(world: vec3): string {
    if (!this.slot || !this.slot.enabled) {
      return ""
    }
    const inv = this.getTransform().getWorldTransform().inverse()
    const local = inv.multiplyPoint(world)
    const halfW = this.rowWidthCm * 0.5 + 1
    const halfH = this.rowHeightCm * 0.5 + 1
    if (Math.abs(local.x) > halfW || Math.abs(local.y) > halfH || Math.abs(local.z) > 4) {
      return ""
    }
    return this.buttonAtLocalX(local.x)
  }

  private buttonNames(): string[] {
    if (this.shown === "clip") {
      return ["Clip"]
    }
    if (this.shown === "edit") {
      return ["Clip", "Undo"]
    }
    if (this.shown === "selected") {
      return ["Clip", "Undo", "Delete", "Save", "+", "−"]
    }
    return []
  }

  private buttonSpans(count: number): number[] {
    const gap = count <= 1 ? 0 : 0.1
    const inner = this.rowWidthCm - 0.4
    const buttonW = (inner - gap * Math.max(0, count - 1)) / Math.max(1, count)
    const total = count * buttonW + Math.max(0, count - 1) * gap
    const spans: number[] = []
    let cursor = -total / 2
    spans.push(cursor)
    for (let i = 0; i < count; i++) {
      cursor += buttonW
      spans.push(cursor)
      cursor += gap
    }
    return spans
  }

  private buttonAtLocalX(x: number): string {
    const names = this.buttonNames()
    if (names.length === 0) {
      return "row"
    }
    const spans = this.buttonSpans(names.length)
    for (let i = 0; i < names.length; i++) {
      if (x >= spans[i] - 0.3 && x <= spans[i + 1] + 0.3) {
        return names[i]
      }
    }
    return "row"
  }

  private raySlab(origin: vec3, dir: vec3): number | null {
    const halfW = this.rowWidthCm * 0.5 + 1.2
    const halfH = this.rowHeightCm * 0.5 + 1.2
    const lo = [-halfW, -halfH, -4]
    const hi = [halfW, halfH, 4]
    const o = [origin.x, origin.y, origin.z]
    const d = [dir.x, dir.y, dir.z]
    let t0 = 5
    let t1 = 120
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

  private presentButtons(): void {
    this.sceneObject.enabled = true
    this.opacity = 1
    this.buttonRow.enabled = true
    this.shelfRow.enabled = false
    this.slot.enabled = true
    this.actions[0].root.enabled = true
    this.actions[1].root.enabled = this.shown !== "clip"
    this.actions[2].root.enabled = this.shown === "selected"
    this.actions[3].root.enabled = this.shown === "selected"
    this.actions[4].root.enabled = this.shown === "selected"
    this.actions[5].root.enabled = this.shown === "selected"
    this.layoutActions()
    this.applyOpacity()
    this.setActionsLive(true)
    this.setCardsLive(false)
  }

  private build(): void {
    if (this.built) {
      return
    }
    this.built = true
    this.rowWidthCm = 18
    this.rowHeightCm = 3.2
    this.slot = this.obj(this.sceneObject, "ControlsSlot")

    this.plateObj = this.obj(this.slot, "ControlsPlate")
    const plate = this.plateObj.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.style = "simple"
    plate.size = new vec2(this.rowWidthCm, this.rowHeightCm)

    const buttonH = Math.max(2.8, this.rowHeightCm - 0.8)
    const buttonW = (this.rowWidthCm - 1.2) / 4
    this.buttonRow = this.flexRow(this.slot, this.rowWidthCm, this.rowHeightCm, {
      gap: 0.35,
      justify: FlexJustify.Center,
      align: FlexAlign.Center,
      track: true,
    })
    this.buttonRow.name = "ButtonRow"
    // Main's ray test presses these. The button trigger was landing on the neighbor.
    this.actions.push(this.addTextButton(this.buttonRow, "ClipButton", this.clipLabel, buttonW, buttonH, () => {}))
    this.actions.push(this.addTextButton(this.buttonRow, "UndoButton", this.undoLabel, buttonW, buttonH, () => {}))
    this.actions.push(this.addTextButton(this.buttonRow, "DeleteButton", this.deleteLabel, buttonW, buttonH, () => {}))
    this.actions.push(this.addTextButton(this.buttonRow, "SaveButton", this.saveLabel, buttonW, buttonH, () => {}))
    this.actions.push(this.addTextButton(this.buttonRow, "PlusButton", "+", buttonW, buttonH, () => {}))
    this.actions.push(this.addTextButton(this.buttonRow, "MinusButton", "−", buttonW, buttonH, () => {}))

    const cardW = (this.rowWidthCm - 1.6) / 3
    this.shelfRow = this.flexRow(this.slot, this.rowWidthCm, this.rowHeightCm, {
      gap: 0.4,
      justify: FlexJustify.Center,
      align: FlexAlign.Center,
      track: false,
    })
    this.shelfRow.name = "SavedSpacesShelf"
    for (let i = 0; i < 3; i++) {
      const made = this.addTextButton(
        this.shelfRow,
        "SpaceCard" + (i + 1),
        "Space\nNov 17",
        cardW,
        buttonH,
        () => this.onOpenCard.invoke(i),
        "Caption"
      )
      this.cards.push({root: made.root, button: made.button, label: made.label})
    }

    this.actions[1].root.enabled = false
    this.actions[2].root.enabled = false
    this.actions[3].root.enabled = false
    this.actions[4].root.enabled = false
    this.actions[5].root.enabled = false
    this.shelfRow.enabled = false
    this.shown = "clip"
    this.sceneObject.enabled = true
  }

  private layoutActions(): void {
    if (!this.layoutReady || !this.buttonLayout) {
      return
    }
    const visible: ActionButton[] = []
    for (let i = 0; i < this.actions.length; i++) {
      if (this.actions[i].root.enabled) {
        visible.push(this.actions[i])
      }
    }
    const count = Math.max(1, visible.length)
    const gap = count <= 1 ? 0 : 0.1
    const inner = this.rowWidthCm - 0.4
    const buttonW = (inner - gap * (count - 1)) / count
    const buttonH = Math.max(2.8, this.rowHeightCm - 0.7)
    const textSize = roleSize("Button") * Math.min(1, buttonW / 4.4)
    const labelHalfH = buttonH * 0.42
    for (let i = 0; i < visible.length; i++) {
      const action = visible[i]
      action.button.size = new vec3(buttonW, buttonH, 0.5)
      action.item.overrideWidth = buttonW
      action.item.overrideHeight = buttonH
      action.label.size = textSize
      action.label.layoutRect = Rect.create(-buttonW / 2 + 0.12, buttonW / 2 - 0.12, -labelHalfH, labelHalfH)
    }
    this.buttonLayout.columnGap = gap
    this.buttonLayout.refreshChildren()
  }

  private brightenPlate(): void {
    if (!this.plateObj) {
      return
    }
    const plate = this.plateObj.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    if (!plate) {
      return
    }
    plate.gradient = false
    plate.backgroundColor = PLATE_COLOR
  }

  private applyOpacity(): void {
    for (let i = 0; i < this.actions.length; i++) {
      this.actions[i].button.opacity = this.opacity
      const color = this.actions[i].label.textFill.color
      this.actions[i].label.textFill.color = new vec4(color.x, color.y, color.z, this.opacity)
    }
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].button.opacity = this.opacity
      const color = this.cards[i].label.textFill.color
      this.cards[i].label.textFill.color = new vec4(color.x, color.y, color.z, this.opacity)
    }
  }

  private setLive(button: Button, live: boolean): void {
    if (button.interactable) {
      button.interactable.enabled = live
    }
  }

  private setActionsLive(live: boolean): void {
    for (let i = 0; i < this.actions.length; i++) {
      this.setLive(this.actions[i].button, live && this.actions[i].root.enabled)
    }
  }

  private setCardsLive(live: boolean): void {
    for (let i = 0; i < this.cards.length; i++) {
      this.setLive(this.cards[i].button, live && this.cards[i].root.enabled)
    }
  }

  private addTextButton(
    parent: SceneObject,
    name: string,
    label: string,
    width: number,
    height: number,
    onClick: () => void,
    role: TextRole = "Button"
  ): ActionButton {
    const root = this.obj(parent, name)
    const button = root.createComponent(Button.getTypeName()) as Button
    button.setVariant({theme: "SnapOS3", shape: "Capsule", style: "Primary"})
    button.size = new vec3(width, height, 0.5)
    const text = this.addButtonLabel(root, label, width - 0.4, role)
    const item = root.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideWidth = width
    item.overrideHeight = height
    item.flexGrow = 0
    item.flexShrink = 0
    const layout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout
    layout.addItems([item])
    button.onTriggerUp.add(() => onClick())
    return {root: root, button: button, label: text, item: item}
  }

  private addButtonLabel(parent: SceneObject, label: string, widthCm: number, role: TextRole): Text {
    const so = this.obj(parent, "ButtonLabel", new vec3(0, 0, BUTTON_LABEL_Z))
    const text = so.createComponent("Component.Text") as Text
    text.text = label
    text.depthTest = true
    applyTextRole(text, role)
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.horizontalOverflow = HorizontalOverflow.Overflow
    text.verticalOverflow = VerticalOverflow.Overflow
    text.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -1.45, 1.45)
    text.textFill.color = new vec4(0.96, 0.98, 1, 1)
    so.createComponent(FlexItem.getTypeName())
    return text
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const sceneObject = global.scene.createSceneObject(name)
    sceneObject.setParent(parent)
    if (position) {
      sceneObject.getTransform().setLocalPosition(position)
    }
    return sceneObject
  }

  private flexRow(
    parent: SceneObject,
    width: number,
    height: number,
    opts: {gap: number; justify: FlexJustify; align: FlexAlign; track: boolean}
  ): SceneObject {
    const container = this.obj(parent, "Flex", new vec3(0, 0, 0.6 + LAYOUT_Z_LIFT))
    const flexLayout = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flexLayout.autoDiscoverItemsOnStart = false
    const flexItem = container.createComponent(FlexItem.getTypeName()) as FlexItem
    flexItem.overrideWidth = width
    flexItem.overrideHeight = height
    flexLayout.onInitialized.add(() => {
      flexLayout.width = width
      flexLayout.height = height
      flexLayout.direction = FlexDirection.Row
      flexLayout.columnGap = opts.gap
      flexLayout.justifyContent = opts.justify
      flexLayout.alignItems = opts.align
      if (opts.track) {
        this.buttonLayout = flexLayout
        this.layoutReady = true
        this.layoutActions()
      }
    })
    return container
  }
}
