// Ball into goal. For each attempt: stand 25 cm behind the ball on the line
// from the ball to the goal, face the goal, walk up so the ball sits 7 cm
// ahead and 5 cm to the right, and kick with the right foot. Walking up can
// nudge the ball further ahead, so check and step up again before kicking.
// A kick sends the ball 0.4-0.8 m; if it stops short, go again.
const g = field.goal;
const side = 0.05; // the ball this far to our right
for (let attempt = 1; attempt <= 3 && !duck.scored(); attempt++) {
  const b = duck.ball();
  const len = Math.hypot(g.x - b.x, g.y - b.y);
  const ux = (g.x - b.x) / len, uy = (g.y - b.y) / len; // ball -> goal
  // We stand to the left of the ball line; the left normal is (-uy, ux).
  await duck.walkTo(b.x - ux * 0.25 - uy * side, b.y - uy * 0.25 + ux * side);
  await duck.turnTo(Math.atan2(uy, ux) * 180 / Math.PI);
  let rel = duck.ballRelative();
  log(`attempt ${attempt}: lined up`, rel);
  // Close the gap, steering sideways onto the line that puts the ball at `side`.
  await duck.walkForward(rel.forward - 0.072, rel.left + side);
  rel = duck.ballRelative();
  if (rel.forward > 0.12) {
    await duck.walkForward(rel.forward - 0.072, rel.left + side);
    rel = duck.ballRelative();
  }
  log('at the ball', rel);
  log('kick', await duck.kick(rel.left < 0 ? 'right' : 'left'));
  await duck.stand(2); // let the ball roll
}
