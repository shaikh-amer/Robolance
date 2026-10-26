// Test bench: blinks pin 13, dims pin 6, moves a servo on 9 when the button on 2 is pressed, prints the pot on A0.
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
}
