/**
 * Pointer sample for the Interactive Preview mouse and for device hands.
 * In the editor the mouse is the fingertip, so a resting simulated hand
 * does not hide clicks. On device a tracked hand wins.
 *
 * The editor sample is a ray through the cursor. The chunk controller
 * measures that ray against the life-size wireframe.
 */

import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {Interactor, InteractorInputType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"

export interface PointerSample {
  active: boolean
  pinching: boolean
  pinchDown: boolean
  pinchUp: boolean
  world: vec3
  hasPoint: boolean
  origin: vec3
  direction: vec3
  hasRay: boolean
  onUi: boolean
}

export class SpaceClipInput {
  private wasPinching = false
  /** A pinch already held when the lens starts must not complete into a click. */
  private skipHeldPinch = true

  sample(camera: Camera): PointerSample {
    try {
      const onUi = this.readOnUi()
      if (global.deviceInfoSystem.isEditor()) {
        const mouse = this.readMouse(camera)
        if (mouse !== null) {
          mouse.onUi = onUi
          return this.finish(mouse)
        }
      }
      const hand = this.readHand()
      if (hand !== null) {
        return this.finish({
          active: true,
          pinching: hand.pinching,
          pinchDown: false,
          pinchUp: false,
          world: hand.world,
          hasPoint: true,
          origin: hand.world,
          direction: vec3.zero(),
          hasRay: false,
          onUi: onUi,
        })
      }
      const mouse = this.readMouse(camera)
      if (mouse !== null) {
        mouse.onUi = onUi
        return this.finish(mouse)
      }
    } catch (err) {
      print("[SpaceClip] input skipped: " + err)
    }
    return this.finish(this.empty(camera))
  }

  private empty(camera: Camera): PointerSample {
    const origin = camera.getTransform().getWorldPosition()
    return {
      active: false,
      pinching: false,
      pinchDown: false,
      pinchUp: false,
      world: origin,
      hasPoint: false,
      origin: origin,
      direction: vec3.zero(),
      hasRay: false,
      onUi: false,
    }
  }

  private finish(sample: PointerSample): PointerSample {
    if (this.skipHeldPinch) {
      this.wasPinching = sample.pinching
      this.skipHeldPinch = false
      sample.pinchDown = false
      sample.pinchUp = false
      return sample
    }
    sample.pinchDown = sample.pinching && !this.wasPinching
    sample.pinchUp = !sample.pinching && this.wasPinching
    this.wasPinching = sample.pinching
    return sample
  }

  private readHand(): {world: vec3; pinching: boolean} | null {
    const hands = SIK.HandInputData
    const sides: ("right" | "left")[] = ["right", "left"]
    let fallback: {world: vec3; pinching: boolean} | null = null
    for (let i = 0; i < sides.length; i++) {
      const hand = hands.getHand(sides[i])
      if (!hand.isTracked()) {
        continue
      }
      const sample = {world: hand.indexTip.position, pinching: hand.isPinching()}
      if (sample.pinching) {
        return sample
      }
      if (fallback === null) {
        fallback = sample
      }
    }
    return fallback
  }

  private readMouse(camera: Camera): PointerSample | null {
    const interactors = SIK.InteractionManager.getInteractorsByType(InteractorInputType.Mouse)
    if (interactors.length === 0) {
      return null
    }
    const mouse: Interactor = interactors[0]
    if (mouse.startPoint === null || mouse.direction === null || mouse.direction.length < 0.001) {
      return null
    }
    const direction = mouse.direction.normalize()
    return {
      active: true,
      pinching: mouse.isTriggering,
      pinchDown: false,
      pinchUp: false,
      world: mouse.startPoint.add(direction.uniformScale(80)),
      hasPoint: false,
      origin: mouse.startPoint,
      direction: direction,
      hasRay: true,
      onUi: false,
    }
  }

  /** Name of the Spectacles Interaction Kit target under the pointer, or "none". */
  interactableName(): string {
    try {
      const interactors = SIK.InteractionManager.getInteractorsByType(InteractorInputType.All)
      for (let i = 0; i < interactors.length; i++) {
        const current = interactors[i].currentInteractable
        if (current) {
          return current.sceneObject.name
        }
      }
    } catch (err) {
      return "none"
    }
    return "none"
  }

  private readOnUi(): boolean {
    const interactors = SIK.InteractionManager.getInteractorsByType(InteractorInputType.All)
    for (let i = 0; i < interactors.length; i++) {
      const current = interactors[i].currentInteractable
      if (!current) {
        continue
      }
      const name = current.sceneObject.name
      if (
        name === "ClipButton" ||
        name === "UndoButton" ||
        name === "DeleteButton" ||
        name === "SaveButton" ||
        name === "PlusButton" ||
        name === "MinusButton" ||
        name === "ControlsPlate" ||
        name.indexOf("SpaceCard") === 0
      ) {
        return true
      }
    }
    return false
  }
}
