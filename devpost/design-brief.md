---
status: approved
---

# Design brief: SpaceClip

<!-- Filled in by plan-lens from the learner's interview. The learner signed off on these choices, including the values that started as defaults. -->

## The one spatial moment
The lens starts quiet. Nothing is drawn on the room. Low in the view there is a single Clip button. You look at the walls and furniture in front of you and press Clip. That view becomes a life-size cyan line sketch of the edges and contours in front of you: shelf lips, frame outlines, the cabinet, the table, and the chair. Neighboring hits are joined into continuous lines. Flat walls stay mostly empty, because sampling is dense only where depth or facing changes. Then the scanning stops. You hover, and the lines near your fingertip brighten. You pinch a chunk and it stays glowing blue. Delete bursts that chunk into sparkles and leaves a gap. Save keeps that chunk as a card on the shelf.

## Why it belongs on glasses
- Uses: shares your view, draws in the world, leaves your body free
- Why it's better than the phone or laptop version: Clip turns the surfaces you are looking at into lines you can pick apart. On a phone that is a picture on a screen.

## Product or overlay
- Type: product. The life-size wireframe is the thing you edit. It is built from one captured view of the surfaces in front of you.
- What the real version would sense: the surfaces in that view, as connected lines along edges and contours. Sampling is dense where depth or facing changes, and sparse on flat walls. It does not recognize objects. A sofa, a table, or a box is just whatever lines are within about 30 cm of your fingertip.
- Stand-in for the preview: the preview's simulated space. Clip samples that room once. No "found it" step and no object names.

## Where things live
- Where the user is looking during the main task: at the room. The wireframe is on the walls and furniture that were in front of you when you pressed Clip, not on a model held up in the center.
- Wireframe: a life-size line sketch. Each shelf board, frame, screen, and cabinet face is a closed outline sitting on that object, not a scatter of dashes on the empty wall. Straight runs, including diagonals, are joined into long strokes, and very short dashes are dropped. A faint glow sits behind the line. It does not keep growing as you look around. Lines stay where they were drawn, including the gaps left by removed chunks. Pressing Clip again clears this wireframe and captures whatever is in front of you now.
- Highlight: the lines within about 30 cm of the cursor (the mouse fingertip in the preview, or the tracked hand on device).
- Selected chunk: stays on the surface and glows bright blue. It does not lift off, follow the hand, or disappear when you let go. Pinching a different highlighted area selects that chunk instead.
- Button row and shelf: one shared slot floating low in the view, about 60 cm forward and about 25 cm below eye level. The row is about 22 cm wide and 4 cm tall, so it does not cover the center of the view. Light colors only. Black would vanish on the additive display.
- Saved Spaces shelf: a short row of small glowing cards in that same slot, up to three cards, newest first. Each card shows the space name and the date. The name is "Space" the first time, and "Space" plus a number after that. The date is the day you saved it. No keyboard. A card is the selected chunk, not the whole wireframe.

## Hands and input
- Clip: a button. Captures the current view once, draws the cyan wireframe, then stops. Pressing it again clears the current wireframe and the current selection, starts a fresh undo stack, and captures the view you are looking at now. Saved cards stay.
- Move the cursor over the wireframe: lines within about 30 cm highlight.
- Pinch the highlighted lines: selects that chunk. It glows bright blue and stays selected. This is a selection, not a grab.
- Delete: a button, shown only while a chunk is selected. The selected chunk bursts into pale light sparkles and is removed. The sparkles stay pale so they read on an additive display. The selection clears.
- Undo: a button, shown after the first capture. Brings back the last removed chunk from this capture. Further taps walk back through earlier removals, one chunk at a time.
- Save: a button, shown only while a chunk is selected. Stores that chunk as a card on the shelf. The selection clears.
- Tap a card: that saved chunk is drawn back onto the surfaces. Lines that are already there stay. Lines that are missing are added. It does not replace the rest of the wireframe.
- Voice (if any) and the button that does the same job: none. There is no Shelf button.

## When things show
- On start: no wireframe. The only control is Clip, in the low slot.
- After a capture: Clip and Undo. Delete and Save stay hidden until a chunk is selected.
- While a chunk is selected: Clip, Undo, Delete, Save, left to right. Clip stays so a new capture is always one press away.
- Highlight: while the cursor is near lines and a chunk is not yet selected, or over a different chunk than the one selected.
- Blue glow: while a chunk is selected, until Delete, Save, or a new Clip.
- Sparkles: when Delete removes a chunk.
- Saved Spaces shelf: shows in the shared slot when Save succeeds, so the new card is visible. Hides after 5 seconds, or when a card is opened. The buttons come back: Clip and Undo, plus Delete and Save only if something is still selected. Save clears the selection, so the return is Clip and Undo.
- If something needs attention out of view: none. The wireframe is on the surfaces from the capture, and the buttons and shelf stay low in front of you.

## Done criteria
Each one can be checked in Lens Studio's Interactive Preview.
1. On start, nothing is scanned and the only control is Clip, low in the view.
2. Pressing Clip once turns the edges and contours in front of you into a cyan life-size line sketch, then scanning stops. Flat walls stay mostly empty.
3. Hovering highlights lines within about 30 cm; a pinch selects that chunk and it stays glowing blue.
4. With a chunk selected, Delete bursts it into sparkles and leaves a gap; Undo brings it back.
5. Save stores that chunk as a card on the shelf; opening the card restores it. Pressing Clip again replaces the current wireframe with a new capture.

## Out of scope
- Recognizing or naming objects. The Lens never decides that a chunk is a sofa.
- A two-hand twist, a pinch-drag spin, or any miniature you shrink the room into.
- Grabbing a chunk so it follows the hand, or tossing it to delete it.
- A Shelf button. The shelf appears when Save succeeds.
- Continuous scanning as you look around.
- Music.
- Editing the real room. Only the wireframe changes.
- Proving that a save reloads after the preview is restarted. The demo is one preview session.

## Risks and open questions
- The shared slot is about 4 cm tall. With Clip, Undo, Delete, and Save in that row, each target is small. Kept so the row stays low and out of the center. Feel unproven until real hands try it.
- One Clip samples the view for a short moment. Surfaces at the edge of that view can be missed. Feel of "did it get the sofa" is unproven until real glasses try it.
- Wireframe cells are stored with PersistentStorage so a later launch on real Spectacles can reopen a space. The preview starts fresh every run, so only saving and reloading from the shelf inside one session can be shown.
- The life-size wireframe in the demo is the simulated room, not a real cluttered space.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for the buttons, so they work with the mouse in Interactive Preview.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep the button row low in the view, not covering the center.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text and lines light.
- Get the basic flow working first, then add detail.
- Check the done criteria in Interactive Preview. Do not add the LEAF package.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Walk the five done criteria in Interactive Preview.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the preview shows working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
