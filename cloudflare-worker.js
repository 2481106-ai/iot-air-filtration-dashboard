/**
 * Cloudflare Worker: authenticated dashboard -> Blynk Cloud command relay.
 *
 * Configure Worker secrets:
 *   DASHBOARD_CONTROL_TOKEN = long random secret entered into the dashboard
 *   BLYNK_DEVICE_TOKEN      = Blynk device Auth Token (never expose in index.html)
 *
 * Blynk datastream mapping:
 *   V0 = filtration blower relay request (0/1)
 *   V1 = UV-C request (0/1; ESP32 must enforce occupancy/fault interlocks)
 *   V2 = cleaning blower request (0/1; firmware must enforce cleaning state machine)
 *   V3 = vibration request (0/1; firmware must enforce cleaning state machine)
 *   V4 = total-system master request (0/1; ON means normal monitoring, OFF means safe stop)
 *   V5 = filtration blower PWM duty request (integer 0-100; ESP32 converts to PWM duty)
 */
const ALLOWED_ORIGIN = "https://2481106-ai.github.io";
const PIN_BY_DEVICE = {
  filtration_blower: "V0",
  filtration_speed: "V5",
  uv_c: "V1",
  cleaning_blower: "V2",
  vibration: "V3",
  total: "V4"
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (origin !== ALLOWED_ORIGIN) return json({ ok: false, error: "Origin not allowed" }, 403, origin);
    if (request.method !== "POST") return json({ ok: false, error: "Use POST" }, 405, origin);
    if (!env.DASHBOARD_CONTROL_TOKEN || !env.BLYNK_DEVICE_TOKEN) {
      return json({ ok: false, error: "Worker secrets are not configured" }, 503, origin);
    }
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.DASHBOARD_CONTROL_TOKEN) {
      return json({ ok: false, error: "Unauthorized" }, 401, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400, origin); }
    const device = body && body.device;
    const isSpeedCommand = device === "filtration_speed";
    const state = body && body.state;
    let value;
    if (!Object.prototype.hasOwnProperty.call(PIN_BY_DEVICE, device)) {
      return json({ ok: false, error: "Unsupported device" }, 400, origin);
    }
    if (isSpeedCommand) {
      value = body && body.value;
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        return json({ ok: false, error: "Speed value must be an integer from 0 to 100" }, 400, origin);
      }
    } else {
      if (!["ON", "OFF"].includes(state)) {
        return json({ ok: false, error: "State must be ON or OFF" }, 400, origin);
      }
      value = state === "ON" ? 1 : 0;
    }

    // Send requests only. ESP32 firmware must enforce safe stop, UV-C interlocks,
    // cleaning sequence, and convert V5's 0-100 percentage into its configured PWM.
    const pin = PIN_BY_DEVICE[device];
    const blynkUrl = new URL("https://blynk.cloud/external/api/update");
    blynkUrl.searchParams.set("token", env.BLYNK_DEVICE_TOKEN);
    blynkUrl.searchParams.set(pin, String(value));

    try {
      const upstream = await fetch(blynkUrl.toString(), { method: "GET", signal: AbortSignal.timeout(8000) });
      const bodyText = (await upstream.text()).slice(0, 300);
      if (!upstream.ok) {
        return json({ ok: false, error: "Blynk rejected command", upstreamStatus: upstream.status }, 502, origin);
      }
      return json({ ok: true, device, ...(isSpeedCommand ? { value } : { state }), pin, relay: "Blynk accepted the API request", upstream: bodyText }, 200, origin);
    } catch (error) {
      return json({ ok: false, error: "Unable to reach Blynk Cloud" }, 502, origin);
    }
  }
};
