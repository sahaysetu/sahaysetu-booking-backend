-- Optional manual setup. The Worker also creates this table automatically.
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
);
