# Workshop verification

Local implementation verification, 2026-10-02. Not a deployment approval or a
claim of commissioned professional animation review.

## Automated checks

- `npm run check`: passed; 12 published routes, local assets, anchors, privacy
  checks, TypeScript, three scroll timeline tests and six exported-rig tests.
- `npm run build`: passed. The dynamically loaded Three.js scene chunk is
  approximately 675 kB before compression and produces Vite's size warning.
- `git diff --check`: passed (Windows line-ending notices only).
- Production preview: model and product screens loaded; no page exceptions in
  the desktop smoke test. Both resume URLs returned 200 with PDF content type.
- Direct chapter navigation aligned the camera and active chapter. Forward and
  reverse timeline tests settle to the same state. Browser verification also
  held the final frame twice, then returned to engagement: contact error was
  identical before and after. `seekWorkshop` unpauses clamped actions before
  every absolute seek to avoid the end-frame reverse-playback regression.
- Reduced-motion mode retained stills and links. An explicit user toggle back
  to full motion made the renderer visible even under the OS reduced preference;
  the explicit choice persisted on reload.
- Forced model failure retained static images and usable content.
- Mobile chapter navigation updated the hash, active location and camera, and
  closed the menu. Low-quality mode retained a 512px contact shadow map.

## Visual and performance checks

Playwright viewport checks covered 1440x900, 1920x1080, 390x844, 844x390 and
1366x600. Compact landscape intentionally uses stills and naturally scrolling
content. Desktop and mobile canvas samples were nonblank and changed with pose.
The viewport matrix had no horizontal overflow or page exceptions. In portrait,
chapter text remains pinned throughout the corresponding action instead of
sliding under the header halfway through the chapter. Settled flight screenshots
changed while scrolling was paused, verifying live secondary motion.

Model plus HDR: approximately 3.74 MB, below the 5 MB asset budget. This is not the
total page transfer size. Later product screenshots load separately.

Desktop measurements used an Intel Core i9-14900HX and NVIDIA RTX 4060 Laptop
GPU. A 24-second six-chapter sweep in headless Chromium at 1440x900 collected
4,888 warm-frame samples: approximately 4.2 ms median and 4.3 ms p95 frame
intervals, with no sampled intervals over 34 ms. These are local foreground RAF
measurements, not GPU timer queries or a guarantee for other hardware. Physical
phone FPS has not been measured.

The fastener test samples 121 engagement positions in each direction and
requires less than 1 mm drift. Additional checks cover a fixed tool/grip offset,
continuous pickup/release, a front-facing screen touch, arm-link clearance from
an expanded screen bounding box, and both camera tracks in both directions.
The clearance test is a conservative sampled proxy, not exhaustive mesh collision
certification for every part of the workshop.

Local artifacts (ignored by Git):

- `output/playwright/desktop-refined.webm`
- `output/playwright/mobile-refined.webm`
- `output/playwright/device-desktop.json`
- `output/playwright/verified-1440-*.png`
- `output/playwright/verified-390-*.png`
- `output/playwright/touch-clear-*.png`
- `output/playwright/final-*-intro.png`
- `output/playwright/final-*-touch.png`

## Physical-device review

Open the local network preview with `?review` on the actual phone. Enter its
model, select Run test, and export the JSON result. The explicit test sweeps all
six chapters in 24 seconds and records frame intervals, viewport, quality and
screen readiness. Touch, wheel, resize or hiding the tab cancels the sweep.
Results stay on the device; there is no telemetry endpoint. Do not report a
desktop mobile viewport as a real-phone result.

## Remaining acceptance

This revision includes modeled mechanical details, finish and lighting refinement,
soft shadows, denser baked animation, grip opening/closing, a close-up camera
sequence, live flight idle motion and a side-approach device touch. Real-phone
performance testing and final visual approval against the reference remain open. Hardware
geometry is illustrative, not approved engineering CAD. No external artist was
contacted or paid, and no production deployment was performed.
