// automation/triggers.ts
// ============================================================
// CASPERS TRANSPORT — AUTOMATION TRIGGERS
// ============================================================
// Runs on a schedule via Vercel Cron Jobs (vercel.json config below)
// Four jobs:
//   1. send_24h_reminders  — fires daily, checks bookings pickup = tomorrow
//   2. send_2h_reminders   — fires hourly, checks bookings pickup within 2h
//   3. send_invoices       — fires every 15 min, checks newly completed bookings
//   4. send_review_requests — fires daily, finds completed jobs from 3 days ago
//
// Each trigger is a separate POST endpoint:
//   POST /api/automation/reminders-24h
//   POST /api/automation/reminders-2h
//   POST /api/automation/invoices
//   POST /api/automation/review-requests
//
// All endpoints are protected by CRON_SECRET header.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';
import twilio           from 'twilio';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const resend = new Resend(process.env.RESEND_API_KEY!);

export const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export const CASPERS_PHONE  = process.env.CASPERS_PHONE_NUMBER!;  // e.g. +61XXXXXXXXXX
export const TWILIO_FROM    = process.env.TWILIO_FROM_NUMBER!;    // your Twilio number
export const APP_URL        = process.env.NEXT_PUBLIC_APP_URL!;
export const ADMIN_EMAIL    = 'admin@casperstransport.com.au';
export const FROM_EMAIL     = 'Caspers Transport <bookings@casperstransport.com.au>';

// Guard: validates cron secret on all automation endpoints
export function validateCronSecret(req: Request): boolean {
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');
  return secret === process.env.CRON_SECRET;
}

// Shared full booking query — used by all triggers
export const BOOKING_QUERY = `
  id, status, trip_type, pickup_date, pickup_time,
  pickup_address, dropoff_address, distance_km, return_km,
  needs_review, notes, deposit_paid, payment_method,
  customers ( id, name, email, phone ),
  bikes ( bike_type, condition, make, model, year ),
  quotes ( total_aud, version, accepted_at )
`;
