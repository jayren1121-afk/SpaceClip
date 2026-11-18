/**
 * Saved-space list and PersistentStorageSystem.
 * Owns names, dates, and the in-memory shelf. Does not touch the scene.
 * A save is the selected chunk only, not the whole wireframe.
 * Preview may start fresh; a failed store must not block the session.
 */

import {SavedSpace, SpaceSnapshot, StoredCell, copyStored, todayLabel} from "./SpaceClipTypes"

const STORE_KEY = "spaceclip.savedSpaces"
const MAX_CARDS = 3

export interface ShelfFile {
  nextNumber: number
  saves: SavedSpace[]
}

export function emptyShelf(): ShelfFile {
  return {nextNumber: 1, saves: []}
}

export function loadShelf(): ShelfFile {
  try {
    const raw = global.persistentStorageSystem.store.getString(STORE_KEY)
    if (!raw || raw.length === 0) {
      return emptyShelf()
    }
    const parsed = JSON.parse(raw) as ShelfFile
    if (!parsed || !parsed.saves) {
      return emptyShelf()
    }
    return {
      nextNumber: parsed.nextNumber > 0 ? parsed.nextNumber : parsed.saves.length + 1,
      saves: parsed.saves.slice(0, MAX_CARDS),
    }
  } catch (err) {
    print("[SpaceClip] persistent load skipped: " + err)
    return emptyShelf()
  }
}

export function storeShelf(file: ShelfFile): void {
  try {
    global.persistentStorageSystem.store.putString(STORE_KEY, JSON.stringify(file))
  } catch (err) {
    print("[SpaceClip] persistent store skipped: " + err)
  }
}

export function copySnapshot(snapshot: SpaceSnapshot): SpaceSnapshot {
  const cellsIn = snapshot.cells || []
  const removedIn = snapshot.removed || []
  const cells: StoredCell[] = []
  for (let i = 0; i < cellsIn.length; i++) {
    cells.push(copyStored(cellsIn[i]))
  }
  const removed: StoredCell[][] = []
  for (let i = 0; i < removedIn.length; i++) {
    const source = removedIn[i] || []
    const chunk: StoredCell[] = []
    for (let j = 0; j < source.length; j++) {
      chunk.push(copyStored(source[j]))
    }
    removed.push(chunk)
  }
  return {cells: cells, removed: removed}
}

/** Newest first. First save is "Space"; later saves are "Space 2", "Space 3", ... */
export function pushSave(file: ShelfFile, snapshot: SpaceSnapshot): SavedSpace {
  const name = file.nextNumber <= 1 ? "Space" : "Space " + file.nextNumber
  file.nextNumber += 1
  const saved: SavedSpace = copySnapshot(snapshot) as SavedSpace
  saved.name = name
  saved.date = todayLabel()
  file.saves.unshift(saved)
  if (file.saves.length > MAX_CARDS) {
    file.saves.length = MAX_CARDS
  }
  return saved
}
