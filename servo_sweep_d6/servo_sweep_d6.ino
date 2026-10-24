#include <Servo.h>

Servo myServo;
const int SERVO_PIN = 6;

void setup() {
  Serial.begin(9600);
  myServo.attach(SERVO_PIN);
  myServo.write(90);
  Serial.println("Nano servo test initialized");
}

void loop() {
  myServo.write(45);
  Serial.println("Commanded 45");
  delay(2000);

  myServo.write(135);
  Serial.println("Commanded 135");
  delay(2000);
}
