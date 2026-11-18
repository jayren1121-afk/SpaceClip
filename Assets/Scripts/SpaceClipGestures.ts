/**
 * Device hand gestures for the wireframe. The preview has no hands, so this
 * stays idle there and the buttons do the same jobs.
 *
 * Two pinches pull apart or together to scale. A one-hand pinch that flicks
 * fast is a toss. An open palm facing the glasses, held for a second, or a
 * quick swipe to the left, undoes the last action.
 */

import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {PalmState} from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"

export interface GestureFrame {
  enabled: boolean
  scaling: boolean
  scaleJustStarted: boolean
  scaleJustEnded: boolean
  scaleFactor: number
  flick: boolean
  flickPoint: vec3
  undo: boolean
  undoReason: string
}

interface HandPose {
  tracked: boolean
  pinching: boolean
  tip: vec3
  speed: number
  speedRight: number
  palmOpen: boolean
}

const FLICK_SPEED = 70
const SWIPE_SPEED = 40
const PALM_HOLD = 1

export function scaleFactor(startDist: number, dist: number): number {
  if (startDist < 1) {
    return 1
  }
  let factor = dist / startDist
  if (factor < 0.3) {
    factor = 0.3
  } else if (factor > 3) {
    factor = 3
  }
  return factor
}

export function isFlick(speed: number, nearSelection: boolean, otherPinching: boolean): boolean {
  return nearSelection && !otherPinching && speed >= FLICK_SPEED
}

export function isPalmHold(openTowardUser: boolean, heldSeconds: number): boolean {
  return openTowardUser && heldSeconds >= PALM_HOLD
}

export function isSwipeLeft(speedAlongRight: number, pinching: boolean): boolean {
  return !pinching && speedAlongRight <= -SWIPE_SPEED
}

/** Logs one line when the gesture rules still match their examples. */
export function gestureSelfCheck(): boolean {
  const ok =
    Math.abs(scaleFactor(10, 14) - 1.4) < 0.001 &&
    scaleFactor(10, 1) === 0.3 &&
    isFlick(80, true, false) &&
    !isFlick(80, true, true) &&
    !isFlick(20, true, false) &&
    isPalmHold(true, 1) &&
    !isPalmHold(true, 0.4) &&
    isSwipeLeft(-50, false) &&
    !isSwipeLeft(-50, true)
  print(ok ? "[SpaceClip] gestures ready" : "[SpaceClip] gestures check failed")
  return ok
}

export class SpaceClipGestures {
  private scaling = false
  private scaleStart = 1
  private lastFactor = 1
  private suppressFlickUntil = 0
  private palmStart = -1
  private palmFired = false
  private swipeUntil = 0
  private leftWasPinch = false
  private rightWasPinch = false
  private leftTip = vec3.zero()
  private rightTip = vec3.zero()
  private leftSpeed = vec3.zero()
  private rightSpeed = vec3.zero()
  private leftTime = -1
  private rightTime = -1

  sample(camera: Camera): GestureFrame {
    const idle = this.empty()
    if (global.deviceInfoSystem.isEditor()) {
      return idle
    }
    try {
      return this.read(camera)
    } catch (err) {
      print("[SpaceClip] gestures skipped: " + err)
      return idle
    }
  }

  private empty(): GestureFrame {
    return {
      enabled: false,
      scaling: false,
      scaleJustStarted: false,
      scaleJustEnded: false,
      scaleFactor: 1,
      flick: false,
      flickPoint: vec3.zero(),
      undo: false,
      undoReason: "",
    }
  }

  private read(camera: Camera): GestureFrame {
    const frame = this.empty()
    frame.enabled = true
    const rightAxis = camera.getTransform().right
    const left = this.pose("left", rightAxis)
    const right = this.pose("right", rightAxis)
    const both = left.tracked && right.tracked && left.pinching && right.pinching
    if (both) {
      const dist = left.tip.sub(right.tip).length
      if (!this.scaling) {
        this.scaling = true
        this.scaleStart = Math.max(1, dist)
        frame.scaleJustStarted = true
      }
      this.lastFactor = scaleFactor(this.scaleStart, dist)
      frame.scaling = true
      frame.scaleFactor = this.lastFactor
    } else if (this.scaling) {
      this.scaling = false
      frame.scaleJustEnded = true
      frame.scaleFactor = this.lastFactor
      this.suppressFlickUntil = getTime() + 0.35
    }
    const now = getTime()
    if (now >= this.suppressFlickUntil && !both) {
      if (this.leftWasPinch && !left.pinching && !right.pinching && left.speed >= FLICK_SPEED) {
        frame.flick = true
        frame.flickPoint = left.tip
      } else if (this.rightWasPinch && !right.pinching && !left.pinching && right.speed >= FLICK_SPEED) {
        frame.flick = true
        frame.flickPoint = right.tip
      }
    }
    this.leftWasPinch = left.pinching
    this.rightWasPinch = right.pinching
    if (frame.flick || frame.scaling) {
      this.palmStart = -1
      this.palmFired = false
      return frame
    }
    const palm = left.palmOpen || right.palmOpen
    if (palm) {
      if (this.palmStart < 0) {
        this.palmStart = now
      }
      if (!this.palmFired && now - this.palmStart >= PALM_HOLD) {
        this.palmFired = true
        frame.undo = true
        frame.undoReason = "palm"
      }
    } else {
      this.palmStart = -1
      this.palmFired = false
    }
    if (!frame.undo && now >= this.swipeUntil) {
      if (isSwipeLeft(left.speedRight, left.pinching) || isSwipeLeft(right.speedRight, right.pinching)) {
        this.swipeUntil = now + 0.8
        frame.undo = true
        frame.undoReason = "swipe"
      }
    }
    return frame
  }

  private pose(side: "left" | "right", cameraRight: vec3): HandPose {
    const hand = SIK.HandInputData.getHand(side)
    const missed: HandPose = {
      tracked: false,
      pinching: false,
      tip: vec3.zero(),
      speed: 0,
      speedRight: 0,
      palmOpen: false,
    }
    if (!hand.isTracked() || hand.indexTip === null || hand.indexTip.position === null) {
      return missed
    }
    const tip = hand.indexTip.position
    const now = getTime()
    const prevTip = side === "left" ? this.leftTip : this.rightTip
    const prevTime = side === "left" ? this.leftTime : this.rightTime
    let velocity = vec3.zero()
    const dt = now - prevTime
    if (prevTime > 0 && dt > 0.001 && dt < 0.25) {
      velocity = tip.sub(prevTip).uniformScale(1 / dt)
    }
    if (side === "left") {
      this.leftTip = tip
      this.leftTime = now
      this.leftSpeed = velocity
    } else {
      this.rightTip = tip
      this.rightTime = now
      this.rightSpeed = velocity
    }
    return {
      tracked: true,
      pinching: hand.isPinching(),
      tip: tip,
      speed: velocity.length,
      speedRight: velocity.dot(cameraRight),
      palmOpen: hand.palmState === PalmState.Flat && hand.isFacingCamera(),
    }
  }
}
