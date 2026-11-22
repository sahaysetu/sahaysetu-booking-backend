const ALLOWED_ORIGINS = ["*"]; // Replace "*" with your HixCode website origin before production.

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
      "Cache-Control": "no-store"
    }
  });
}

function getOrigin(request) {
  const origin = request.headers.get("Origin") || "*";
  if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) return origin;
  return null;
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sahaysetu_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_ref TEXT NOT NULL UNIQUE,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      doctor_specialty TEXT,
      consultation_type TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      admin_note TEXT
    )
  `).run();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return false;
  const local = new Date();
  local.setHours(0, 0, 0, 0);
  return d >= local && d.toISOString().slice(0, 10) === value;
}

function makeReference() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return "SH-" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function handle(request, env) {
  const origin = getOrigin(request);
  if (!origin) return json({ success: false, message: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/api/health") {
    return json({ success: true, service: "SAHAYSETU Booking API", status: "running" }, 200, origin);
  }

  if (!env.DB) {
    return json({ success: false, message: "D1 binding DB is missing" }, 500, origin);
  }

  if (path === "/api/db-check" && request.method === "GET") {
    try {
      await ensureSchema(env.DB);
      const result = await env.DB.prepare("SELECT 1 AS connected").first();
      return json({ success: true, database: "connected", result }, 200, origin);
    } catch (error) {
      console.error("D1 check failed:", error);
      return json({ success: false, message: "Database check failed" }, 500, origin);
    }
  }

  if (path === "/api/bookings" && request.method === "POST") {
    try {
      const body = await request.json();
      const patientName = String(body.patientName || "").trim();
      const patientPhone = String(body.patientPhone || "").replace(/\D/g, "");
      const doctorName = String(body.doctorName || "").trim();
      const doctorSpecialty = String(body.doctorSpecialty || "").trim();
      const consultationType = String(body.consultationType || "").trim();
      const appointmentDate = String(body.appointmentDate || "").trim();
      const appointmentTime = String(body.appointmentTime || "").trim();

      if (patientName.length < 2 || patientName.length > 100) {
        return json({ success: false, message: "Enter a valid patient name." }, 400, origin);
      }
      if (!/^[6-9]\d{9}$/.test(patientPhone)) {
        return json({ success: false, message: "Enter a valid 10-digit Indian mobile number." }, 400, origin);
      }
      if (!doctorName || doctorName.length > 120) {
        return json({ success: false, message: "Doctor details are missing." }, 400, origin);
      }
      if (!["Video Consultation", "Audio Consultation", "In-person Consultation"].includes(consultationType)) {
        return json({ success: false, message: "Select a valid consultation type." }, 400, origin);
      }
      if (!validDate(appointmentDate)) {
        return json({ success: false, message: "Select today or a future appointment date." }, 400, origin);
      }
      if (!appointmentTime || appointmentTime.length > 60) {
        return json({ success: false, message: "Select a valid preferred time." }, 400, origin);
      }

      await ensureSchema(env.DB);

      const idem = request.headers.get("Idempotency-Key");
      if (idem) {
        const existing = await env.DB.prepare(
          "SELECT booking_ref, status FROM sahaysetu_bookings WHERE booking_ref = ?"
        ).bind(idem).first();
        if (existing) return json({ success: true, booking: existing, duplicate: true }, 200, origin);
      }

      const bookingRef = makeReference();
      await env.DB.prepare(`
        INSERT INTO sahaysetu_bookings
        (booking_ref, patient_name, patient_phone, doctor_name, doctor_specialty,
         consultation_type, appointment_date, appointment_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        bookingRef, patientName, patientPhone, doctorName, doctorSpecialty,
        consultationType, appointmentDate, appointmentTime
      ).run();

      return json({
        success: true,
        message: "Appointment request received. It is pending review and is not yet confirmed.",
        booking: { bookingRef, status: "pending" }
      }, 201, origin);
    } catch (error) {
      console.error("Booking submission failed:", error);
      return json({ success: false, message: "Unable to save the booking. Please try again." }, 500, origin);
    }
  }

  if (path === "/api/admin/bookings" && request.method === "GET") {
    if (!env.ADMIN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
      return json({ success: false, message: "Unauthorized" }, 401, origin);
    }
    try {
      await ensureSchema(env.DB);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      const rows = await env.DB.prepare(`
        SELECT booking_ref, patient_name, patient_phone, doctor_name, doctor_specialty,
               consultation_type, appointment_date, appointment_time, status,
               created_at, updated_at, admin_note
        FROM sahaysetu_bookings ORDER BY id DESC LIMIT ?
      `).bind(limit).all();
      return json({ success: true, bookings: rows.results || [] }, 200, origin);
    } catch (error) {
      console.error("Admin list failed:", error);
      return json({ success: false, message: "Unable to retrieve bookings." }, 500, origin);
    }
  }

  const statusMatch = path.match(/^\/api\/admin\/bookings\/([A-Z0-9-]+)$/);
  if (statusMatch && request.method === "PATCH") {
    if (!env.ADMIN_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
      return json({ success: false, message: "Unauthorized" }, 401, origin);
    }
    try {
      const body = await request.json();
      const status = String(body.status || "").toLowerCase();
      const note = String(body.adminNote || "").trim().slice(0, 500);
      if (!["confirmed", "rejected", "rescheduled", "pending"].includes(status)) {
        return json({ success: false, message: "Invalid booking status." }, 400, origin);
      }
      await ensureSchema(env.DB);
      const result = await env.DB.prepare(`
        UPDATE sahaysetu_bookings
        SET status = ?, admin_note = ?, updated_at = datetime('now')
        WHERE booking_ref = ?
      `).bind(status, note, statusMatch[1]).run();
      if (!result.meta || result.meta.changes === 0) {
        return json({ success: false, message: "Booking not found." }, 404, origin);
      }
      return json({ success: true, bookingRef: statusMatch[1], status }, 200, origin);
    } catch (error) {
      console.error("Admin update failed:", error);
      return json({ success: false, message: "Unable to update booking." }, 500, origin);
    }
  }

  return json({ success: false, message: "SAHAYSETU API endpoint not found" }, 404, origin);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error("Unhandled Worker error:", error);
      return json({ success: false, message: "Internal server error" }, 500);
    }
  }
};
