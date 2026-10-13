# Dashboard-to-ESP32 control setup

The GitHub Pages dashboard currently reads telemetry from ThingSpeak Channel 3521125. This optional control path uses a Cloudflare Worker as an authenticated relay to Blynk Cloud. **The Worker and ESP32 firmware are not deployed/configured automatically by committing these files.**

## Architecture

GitHub Pages dashboard → Cloudflare Worker (HTTPS + bearer token) → Blynk Cloud → ESP32 firmware → safe actuator control.

Do not place the Blynk device Auth Token in `index.html`. Store it as a Cloudflare Worker secret.

## 1. Create Blynk datastreams

In Blynk Console, create five Integer datastreams with values 0–1:

| Virtual pin | Name | Meaning |
|---|---|---|
| V0 | Filtration blower request | 0 OFF / 1 ON request |
| V1 | UV-C request | 0 OFF / 1 ON request, subject to occupancy interlock |
| V2 | Cleaning blower request | Request only; cleaning state machine must permit it |
| V3 | Vibration request | Request only; cleaning state machine must permit it |
| V4 | Total system request | 0 safe stop / 1 normal monitoring mode |

Copy the device Auth Token for the Blynk device. Do not commit it to this repository.

## 2. Deploy the Cloudflare Worker

1. Sign in to Cloudflare and create a Worker named, for example, `iot-air-filter-control`.
2. Copy the contents of `cloudflare-worker.js` into the Worker editor and deploy it.
3. In Worker Settings → Variables and Secrets, add these as **Secrets**:
   - `DASHBOARD_CONTROL_TOKEN`: generate a long random secret. Enter the same value in the dashboard's access-token box.
   - `BLYNK_DEVICE_TOKEN`: the Blynk device Auth Token.
4. Use the Worker HTTPS URL as the dashboard's control endpoint. It should be the Worker root URL unless you change the Worker routing.
5. The Worker currently permits browser requests only from `https://2481106-ai.github.io`. If you use a different GitHub Pages hostname, change `ALLOWED_ORIGIN` accordingly before deploying.

## 3. ESP32 firmware integration — required before operating hardware

The ESP32 firmware must connect to the same Blynk device and handle V0–V4. The handlers must set *requests*, not bypass the existing state machine:

- V0: enable/disable filtration blower, with safe PWM handling.
- V1: treat as a UV-C request only. UV-C must remain OFF if occupancy is detected, the occupancy sensor is faulty, or any diagnostic/fault condition is active. Re-check occupancy continuously.
- V2 and V3: accept manual requests only when the cleaning state machine explicitly permits them. Do not allow them to bypass suction-first timing, vibration timing, or the safe cleaning sequence.
- V4 OFF: immediately enter the firmware's safe-stop state and turn off UV-C, vibration, and cleaning blower; stop filtration blower as appropriate for the design.
- V4 ON: enter normal monitoring mode; do not automatically turn on UV-C or start cleaning.
- Faults and interlocks must override every dashboard command.

Keep ThingSpeak telemetry fields 1–8 and their 20-second upload schedule unchanged. Do not run the Blynk and ThingSpeak connection loops in a blocking way that prevents sensor sampling, LCD updates, occupancy checks, or safety handling.

**Important:** These datastreams and Worker only relay commands. Until the matching Blynk handlers are integrated and tested in the current PlatformIO firmware, the switches must not be considered operational hardware controls.

## 4. Test safely

1. Test first with actuators disconnected or replaced by LEDs in Wokwi.
2. Confirm invalid token requests return 401, and unknown device/state requests are rejected.
3. Verify Total OFF disables all outputs.
4. Verify UV-C cannot turn on with occupancy present or with an occupancy-sensor fault.
5. Verify cleaning blower and vibration requests cannot bypass the programmed cleaning sequence.
6. Only then test with the prototype hardware under supervised conditions.
