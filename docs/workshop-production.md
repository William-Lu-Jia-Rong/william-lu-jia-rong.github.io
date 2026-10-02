# Bill's Workshop

## What ships

The homepage is a single Three.js workshop, driven by native scroll. An original
rigid-joint robot picks up a driver, engages a motor fastener, returns the tool,
travels to an aerial robotics station, and operates a PocketPilot device. A final
station shows a SmartRouteOS screen and an illustrative routing sequence.

The assets were authored for this project in Blender. They are editable production
inputs, not a claim that an external professional animator has reviewed the work.
The workshop, PCB and aircraft are illustrative; project outcomes remain in the
HTML and linked case studies. No real-time telemetry is implied.

## Asset delivery

- `assets/3d/bill-workshop.blend`: editable geometry, procedural PBR materials,
  named mechanical joint transforms, baked performance and two camera tracks.
- `assets/3d/bill-workshop.glb`: self-contained web export. No external texture
  dependencies for the robot; actual product screens are loaded separately.
- `build/create-workshop.py`: reproducible Blender 5.1 authoring source.
- `images/workshop/*.jpg`: stills captured from the actual browser renderer.
- `assets/3d/ATTRIBUTIONS.md`: authorship and third-party lighting attribution.

Rebuild using Blender in background mode:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python build/create-workshop.py
npm run check
npm run build
```

Mechanical links are a rigid transform rig, not a deforming skin. Arm reach is
solved in the authoring script, then baked into GLB translation/quaternion tracks.
The tool and wrist share the same sampled contact position while engaged. Wheel
rotation and chassis turn-in/turn-out are baked too. Keep the named camera,
screen and contact nodes when replacing or refining assets.

## Storyboard

| Chapter | Timeline | Performance | Camera |
| --- | --- | --- | --- |
| Intro | 0-.14 | Inspect the bench and prepare to work | Establish the robot and control bench |
| Embedded | .14-.34 | Pick up, engage, turn, return, release | Push into the tool contact, then track toward flight |
| Flight | .34-.52 | Launch gesture, rise and short test flight | Follow the aircraft before tracking to the device |
| PocketPilot | .52-.70 | Approach and touch the device; capture becomes insights | Device-focused framing with actual screenshots |
| AI | .70-.88 | Robot gives space to routing and feedback | Monitor and network view |
| Profile | .88-1 | Robot returns through the workspace | Pull back to the whole workshop |

`js/workshop-shots.js` defines the chapter boundaries. The corresponding baked
performance occupies 30 seconds, starting at 1/30 second in the exported clips.
All actions and cameras are sampled from the same absolute progress so reversing
scroll or jumping to an anchor does not replay intermediate actions.

## Rendering and layout

`workshop-world.js` owns loading, batching within animated joints, lighting,
screen textures, camera selection and disposal. `workshop.js` owns scroll,
navigation, accessibility preferences, startup timeout and visibility handling.
`avatar-timeline.js` remains the native-scroll clock.

The renderer sleeps when scroll settles except for 30-fps-capped optical idle
and flight hover/rotor motion. These secondary effects do not change tool contact.
Late screen/HDR loads invalidate one frame. Fullscreen scenery is masked behind text to preserve readability. Portrait
screens use the mobile camera and a lower composition, with dedicated device
interaction framing; compact landscape and short portrait views use
scrollable stills so project content is never hidden to make room for animation.

Reduced motion, data saver, failed startup and lost WebGL context retain all
content, project links and genuine scene images. The initial model and HDR have
a combined 5 MB budget enforced by the validator. Screens load after the early
chapters. Low sustained frame rates trigger lower pixel density and shadow cost;
contact shadows remain enabled. Mobile shadows use 1024px maps, desktop 2048px,
and the low-quality tier 512px.

## Review and refinement

Use `?debug` on the local preview to inspect `window.__workshop.diagnostics()` or
sample an exact authored pose with `window.__workshop.sample(progress)`.
`?debug&poster=embedded` renders a clean still; supported chapter IDs are listed
in the storyboard configuration. Use 1200x900 for the shipped fallback stills.

Review the tool throughout .205-.265 in both scroll directions, not just one
frame. Check contact, arm joints, wheel motion, mobile framing and continuity.
Professional refinement can replace the illustrative geometry/materials while
keeping the existing chapter, camera and screen contracts. Real PCB photography
or approved CAD can replace illustrative hardware when supplied.

Local verification artifacts, including viewport screenshots and scroll recordings,
are written to `output/playwright/` and excluded from source control. Device
emulation on a desktop GPU is not a substitute for a physical phone performance test.
