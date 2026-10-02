// Blender exports frames 1..901 at 30 fps. Always seek from an absolute clock.
export function seekWorkshop(mixer, actions, progress) {
  const position = Math.max(0, Math.min(1, progress));
  // LoopOnce pauses at its end; unpause before seeking backwards or holding there.
  actions.forEach((action) => {
    action.paused = false;
  });
  mixer.setTime(position * 30 + 1 / 30);
  return position;
}
