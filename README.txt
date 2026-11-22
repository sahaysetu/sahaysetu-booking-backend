SAHAYSETU Booking API
=====================

Files
- worker.js: Cloudflare Worker source.
- schema.sql: optional manual D1 schema (the Worker creates the table automatically).

Required Cloudflare configuration
1. Bind the existing D1 database to this Worker with variable name DB.
2. Add a Worker secret named ADMIN_TOKEN with a long random value.
3. Before production, edit ALLOWED_ORIGINS in worker.js and replace "*" with the exact public origin of the HixCode website, e.g. https://your-domain.example.
4. Deploy.

Endpoints
GET  /api/health
GET  /api/db-check
POST /api/bookings
GET  /api/admin/bookings              Authorization: Bearer <ADMIN_TOKEN>
PATCH /api/admin/bookings/SH-...      Authorization: Bearer <ADMIN_TOKEN>

POST /api/bookings JSON body:
{
  "patientName": "Patient Name",
  "patientPhone": "9876543210",
  "doctorName": "Doctor Name",
  "doctorSpecialty": "Specialty",
  "consultationType": "Video Consultation",
  "appointmentDate": "YYYY-MM-DD",
  "appointmentTime": "09:00 AM - 10:00 AM"
}

A successful submission creates a PENDING request, not a confirmed appointment.
Admin PATCH JSON body:
{"status":"confirmed","adminNote":"Confirmed by clinic"}
Allowed statuses: pending, confirmed, rejected, rescheduled.

Security note
Do not put ADMIN_TOKEN in the public HixCode JavaScript. Admin endpoints must be called only from a trusted server-side/admin environment.
