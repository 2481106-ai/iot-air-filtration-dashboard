# ESP32 firmware patch for dashboard control commands

The user-provided file is an HTML dashboard, not the ESP32 source. This file documents the control-handler integration to apply to the existing PlatformIO `src/main.cpp` without replacing its sensors, LCD, ThingSpeak upload, relay polarity, PWM setup, or cleaning state machine.

## Blynk virtual pin contract

| Pin | Dashboard device key | Request |
|---|---|---|
| V0 | `filtration_blower` | Filtration blower relay ON/OFF (24 V DC, 1 A) |
| V5 | `filtration_speed` | Filtration blower PWM speed request, 0–100% |
| V1 | `uv_c` | UV-C request |
| V2 | `cleaning_blower` | Suction blower request |
| V3 | `vibration` | Vibration motors request |
| V4 | `total` | Master system request |

Create integer datastreams in Blynk Console: V0–V4 use 0/1; V5 uses 0–100. The Cloudflare Worker in `cloudflare-worker.js` updates these datastreams.

## Handler snippet

Add the following after the existing Blynk include and before `setup()`. It only records requests; it deliberately does not drive GPIO pins directly.

```cpp
// Dashboard requests. These are NOT the confirmed physical output states.
volatile bool dashboardFiltrationRequest = false; // V0: relay ON/OFF
volatile uint8_t dashboardFiltrationSpeedPercent = 70; // V5: requested PWM speed, 0-100
volatile bool dashboardUvRequest = false;         // V1
volatile bool dashboardCleaningBlowerRequest = false; // V2
volatile bool dashboardVibrationRequest = false;  // V3
volatile bool dashboardSystemRequest = false;     // V4

BLYNK_WRITE(V0) {
  dashboardFiltrationRequest = (param.asInt() == 1);
}
BLYNK_WRITE(V5) {
  int requestedPercent = param.asInt();
  if (requestedPercent >= 0 && requestedPercent <= 100) {
    dashboardFiltrationSpeedPercent = (uint8_t)requestedPercent;
  }
}
BLYNK_WRITE(V1) {
  dashboardUvRequest = (param.asInt() == 1);
}
BLYNK_WRITE(V2) {
  dashboardCleaningBlowerRequest = (param.asInt() == 1);
}
BLYNK_WRITE(V3) {
  dashboardVibrationRequest = (param.asInt() == 1);
}
BLYNK_WRITE(V4) {
  dashboardSystemRequest = (param.asInt() == 1);
}
```

## Required main-loop integration

These handlers cannot safely control the prototype by themselves. In the existing non-blocking main loop, consume the request flags through your existing state machine and actual sensor/interlock variables:

1. **Master OFF:** enter the existing safe-stop state. Force UV-C OFF and vibration OFF immediately; stop the cleaning blower safely; stop or retain the filtration blower according to the documented safe-stop design.
2. **Master ON:** enter normal monitoring mode. Do not automatically enable UV-C or initiate cleaning.
3. **Filtration blower:** V0 controls the relay that connects/disconnects the 24 V supply. V5 sets the requested PWM percentage for the MOSFET switching stage. When the relay is OFF or the master system is OFF/faulted, force PWM to 0 and ensure the output is safely disabled. The blower is rated 24 V DC, 1 A (nominal 24 W). Since it has two power wires, PWM is applied to the supply path; confirm the blower supports supply-side PWM. Use a properly rated MOSFET/driver, DC-rated relay, fuse and inductive-load suppression. Preserve existing fault handling.
4. **UV-C:** permit ON only when the occupancy sensor reports vacant, the occupancy reading is healthy, and no diagnostic/fault/safety condition is active. Recheck continuously, not only when the command arrives.
5. **Cleaning blower and vibration:** treat dashboard values as requests only. The current cleaning state machine must retain control of timing and sequencing (suction first, then vibration, and the configured shutdown order). Reject manual ON requests whenever cleaning is not in an allowed state.
6. **Fault handling:** faults and safety interlocks override all dashboard requests. When a request is rejected, publish the actual output/state to Blynk so the dashboard can be updated to the real state.

Do not call long blocking delays while processing Blynk. Preserve SDS011 sampling, pressure sensing, LCD updates, ThingSpeak telemetry and the existing 15-second normal / 5-second cleaning logging requirements.

## Before hardware testing

The existing `src/main.cpp` was not present in the supplied upload or dashboard repository when this note was created. Therefore this is an integration patch, not a compiled replacement firmware. GPIO numbers, relay active level, PWM channel/frequency and resolution, occupancy sensor polarity, and the exact cleaning-state names must be taken from the real project source before merging. The V5 handler only records a percentage request; the main loop must convert it to the configured PWM duty and must not directly energize the blower when V0/master OFF/fault is active.

Test with actuator outputs disconnected or replaced with indicator LEDs first. Never use a dashboard command to bypass the UV-C occupancy interlock or cleaning state machine.
