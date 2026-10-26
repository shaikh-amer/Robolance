import { buildSketch } from '../packages/hardware-tools/lib/index.js';
import { runScenario } from '../packages/hardware-sim/lib/index.js';
const sketch = `
#include <Servo.h>
Servo arm;
const int BTN = 2;
void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
  arm.attach(9);
  arm.write(30);
  Serial.println("ready");
}
void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(200);
  digitalWrite(LED_BUILTIN, LOW);
  delay(200);
  if (digitalRead(BTN) == LOW) { arm.write(150); Serial.println("pressed"); }
  analogWrite(6, 64);
  Serial.print("pot="); Serial.println(analogRead(A0));
}`;
const t0 = Date.now();
const build = await buildSketch(sketch);
console.log('build', build.backend, build.ok, build.size, 'in', Date.now() - t0, 'ms');
if (!build.ok) { console.log(build.output); process.exit(1); }
const diagram = { parts: [
  { type: 'led', id: 'led13', pin: 13, color: 'green' },
  { type: 'led', id: 'dim', pin: 6 },
  { type: 'button', id: 'btn', pin: 2 },
  { type: 'servo', id: 'arm', pin: 9 },
  { type: 'potentiometer', id: 'pot', pin: 'A0' },
] };
const t1 = Date.now();
const trace = runScenario(build.hex, diagram, { durationMs: 3000, events: [ { atMs: 1000, action: 'tap', part: 'btn', holdMs: 500 }, { atMs: 1500, action: 'set', part: 'pot', value: 0.75 } ] });
console.log('ran', trace.ranMs, 'ms in', Date.now() - t1, 'ms real');
console.log('serial', trace.serial.slice(0, 8));
console.log('final', JSON.stringify(trace.final));
console.log('notes', trace.notes);
const ons = trace.samples.map(s => s.parts.led13.on);
console.log('led13 samples', ons.join(''));
