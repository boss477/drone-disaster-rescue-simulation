#include <Servo.h>
#include <SoftwareSerial.h>
#include <TinyGPSPlus.h>

const int SERVO_PIN = 9;
const int GPS_RX_PIN = 4;
const int GPS_TX_PIN = 3;
const int LOCKED = 0;
const int RELEASED = 90;

Servo latch;
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus gps;
unsigned long lastSend = 0;

void setup() {
  Serial.begin(9600);
  gpsSerial.begin(9600);
  latch.attach(SERVO_PIN);
  latch.write(LOCKED);
}

void loop() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());

  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'R') { latch.write(RELEASED); Serial.println("STATUS,RELEASED"); }
    if (c == 'L') { latch.write(LOCKED);   Serial.println("STATUS,LOCKED"); }
  }

  if (millis() - lastSend > 1000) {
    lastSend = millis();
    if (gps.location.isValid()) {
      Serial.print("GPS,");
      Serial.print(gps.location.lat(), 6);
      Serial.print(",");
      Serial.print(gps.location.lng(), 6);
      Serial.print(",");
      Serial.println(gps.satellites.value());
    } else {
      Serial.println("GPS,NOFIX");
    }
  }
}
