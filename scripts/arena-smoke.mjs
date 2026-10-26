import { buildSketch } from '../packages/hardware-tools/lib/index.js';
import { runScenario } from '../packages/hardware-sim/lib/index.js';
const sketch = `
// Wall follower: drive forward, turn right when a wall is close.
const int L1 = 4, L2 = 5, LEN = 6;
const int R1 = 7, R2 = 8, REN = 10;
const int TRIG = 12, ECHO = 11;
long readCm() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  return us ? us / 58 : 400;
}
void drive(int l, int r) {
  digitalWrite(L1, l > 0); digitalWrite(L2, l < 0); analogWrite(LEN, abs(l));
  digitalWrite(R1, r > 0); digitalWrite(R2, r < 0); analogWrite(REN, abs(r));
}
void setup() {
  Serial.begin(115200);
  int pins[] = {L1, L2, LEN, R1, R2, REN, TRIG};
  for (int p : pins) pinMode(p, OUTPUT);
  pinMode(ECHO, INPUT);
}
void loop() {
  long cm = readCm();
  Serial.print("cm="); Serial.println(cm);
  if (cm < 25) { drive(200, -200); delay(350); }
  else { drive(255, 255); delay(50); }
}`;
const build = await buildSketch(sketch);
console.log('build', build.ok, build.size);
if (!build.ok) { console.log(build.output); process.exit(1); }
const diagram = { parts: [
  { type: 'motor', id: 'left', in1: 4, in2: 5, en: 6 },
  { type: 'motor', id: 'right', in1: 7, in2: 8, en: 10 },
  { type: 'ultrasonic', id: 'eyes', trig: 12, echo: 11 },
], arena: { preset: 'corner', left: 'left', right: 'right', sensor: 'eyes' } };
const t = Date.now();
const trace = runScenario(build.hex, diagram, { durationMs: 20000, sampleEveryMs: 1000, maxRealMs: 60000 });
console.log('ran', trace.ranMs, 'ms in', Date.now() - t, 'ms real');
console.log('serial', trace.serial.slice(0, 6), '...', trace.serial.length, 'lines');
console.log('arena', JSON.stringify({ ...trace.arena, path: undefined, events: trace.arena.events.slice(0, 5) }));
console.log('path', trace.arena.path.filter((_, i) => i % 20 === 0).map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}@${p.headingDeg.toFixed(0)}`).join(' '));
console.log('notes', trace.notes);
