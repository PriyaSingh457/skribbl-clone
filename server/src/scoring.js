export function calculateGuessPoints({ drawTimeSeconds, elapsedSeconds }) {
  const duration = Math.max(1, Number(drawTimeSeconds) || 1);
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const remainingRatio = Math.max(0, Math.min(1, (duration - elapsed) / duration));
  return Math.max(25, Math.round(100 * remainingRatio));
}
