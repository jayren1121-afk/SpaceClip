# SpaceClip

A Lens for Snap Spectacles, built for the Learn AR with SPECS hackathon. Press Clip to trace a real object in glowing cyan 3D lines, then select, delete, undo, scale and move its parts right where it stands.

- Built with Lens Studio 5.24.1, CLAD and the Lens Studio MCP, with an AI coding agent (Cursor).
- Planning documents from the Devpost Learn skill pack are in [`devpost/`](devpost/design-brief.md).
- Open `SpaceClip.esproj` in Lens Studio 5.24.1 and use the Interactive Preview. Do not import Leaf or AI Preview Agent Interact, which target a newer Lens Studio.

## Demo furniture
The furniture in Lens Studio's preview room is only a background and can't be read by a Lens, so this demo adds its own box-built chair, table, bookshelf and computer. On Spectacles, SpaceClip would capture real objects from the World Mesh instead.

## Preview controls
Buttons: Clip, Undo, Delete, Save, +, −. Keyboard: Delete or Backspace deletes, Ctrl+Z undoes, + or = scales up 20%, − scales down 20%. Click and hold a wireframe to move it.
