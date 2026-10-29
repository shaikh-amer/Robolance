// The duck's favourite mission: close the developer's laptop so they come and play.
// Run with the laptop on the pitch, e.g. field.laptop = { x: 0.75, y: 0, heading: 0 }.
// From behind the screen: line up on the laptop's centre line, face the hinge, and
// walk into the back of the lid with the head pushed forward.
const l = field.laptop;
const h = (l.heading * Math.PI) / 180;
const ahead = { x: Math.cos(h), y: Math.sin(h) };
const side = { x: -ahead.y, y: ahead.x };
// 33 cm behind the middle of the base, on the side away from the screen.
const behind = { x: l.x - 0.33 * ahead.x, y: l.y - 0.33 * ahead.y };
// If the straight line there crosses the laptop, go round it 38 cm to one side.
const p = duck.pose();
const along = (l.x - p.x) * (behind.x - p.x) + (l.y - p.y) * (behind.y - p.y);
const span = (behind.x - p.x) ** 2 + (behind.y - p.y) ** 2;
const t = Math.max(0, Math.min(1, along / span));
const gap = Math.hypot(p.x + t * (behind.x - p.x) - l.x, p.y + t * (behind.y - p.y) - l.y);
if (gap < 0.3) {
    const s = (p.x - l.x) * side.x + (p.y - l.y) * side.y >= 0 ? 1 : -1;
    await duck.walkTo(l.x + 0.38 * s * side.x, l.y + 0.38 * s * side.y);
    await duck.walkTo(behind.x + 0.38 * s * side.x, behind.y + 0.38 * s * side.y);
}
await duck.walkTo(behind.x, behind.y);
await duck.turnTo(l.heading);
log('lined up', duck.pose(), duck.laptop());
// Steer at the hinge's middle as it goes: the walk drifts, and a lid hit off-centre
// twists the duck away instead of folding.
const hinge = { x: l.x - 0.11 * ahead.x, y: l.y - 0.11 * ahead.y };
const start = duck.time();
while (!duck.laptop().closed && duck.time() - start < 6) {
    const q = duck.pose();
    const want = Math.atan2(hinge.y - q.y, hinge.x - q.x);
    const off = Math.atan2(Math.sin(want - (q.heading * Math.PI) / 180), Math.cos(want - (q.heading * Math.PI) / 180));
    const turn = Math.max(-0.8, Math.min(0.8, 2 * off));
    await duck.skill('walk', 0.4, [0.35, 0, turn, 0.6, 0, 0, 0]);
}
await duck.stand(1);
log('lid', duck.laptop());
