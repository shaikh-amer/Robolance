// Drives forward and turns right when a wall is close. Motors on 4/5/6 and 7/8/10, HC-SR04 on 12/11.
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
}
