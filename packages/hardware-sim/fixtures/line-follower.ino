// Follows a dark line with two reflectance sensors (HIGH over the line) on pins 2 and 3.
// Motors on 4/5/6 and 7/8/10.
const int L1 = 4, L2 = 5, LEN = 6;
const int R1 = 7, R2 = 8, REN = 10;
const int LEFT_EYE = 2, RIGHT_EYE = 3;
void drive(int l, int r) {
  digitalWrite(L1, l > 0); digitalWrite(L2, l < 0); analogWrite(LEN, abs(l));
  digitalWrite(R1, r > 0); digitalWrite(R2, r < 0); analogWrite(REN, abs(r));
}
void setup() {
  Serial.begin(115200);
  int pins[] = {L1, L2, LEN, R1, R2, REN};
  for (int p : pins) pinMode(p, OUTPUT);
  pinMode(LEFT_EYE, INPUT);
  pinMode(RIGHT_EYE, INPUT);
}
void loop() {
  bool l = digitalRead(LEFT_EYE) == HIGH;
  bool r = digitalRead(RIGHT_EYE) == HIGH;
  Serial.print("eyes="); Serial.print(l); Serial.println(r);
  if (l && r) drive(170, 170);
  else if (l) drive(60, 170);
  else if (r) drive(170, 60);
  else drive(120, 120);
  delay(20);
}
