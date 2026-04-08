// automation/triggers.ts
// ============================================================
// CASPERS TRANSPORT — AUTOMATION TRIGGERS
// Shared clients and constants for all cron route handlers.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { Resend }       from 'resend';
import twilio           from 'twilio';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL    || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY   || 'placeholder'
);

export const resend = new Resend(
  process.env.RESEND_API_KEY || 're_placeholder_build_only'
);

export const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID  || 'ACplaceholder',
  process.env.TWILIO_AUTH_TOKEN   || 'placeholder'
);

export const CASPERS_PHONE  = process.env.CASPERS_PHONE_NUMBER ?? '';
export const TWILIO_FROM    = process.env.TWILIO_FROM_NUMBER   ?? '';
export const APP_URL        = process.env.NEXT_PUBLIC_APP_URL  ?? '';
export const ADMIN_EMAIL    = 'admin@casperstransport.com.au';
export const FROM_EMAIL     = 'Caspers Transport <bookings@casperstransport.com.au>';

export function validateCronSecret(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false; // refuse all if secret not configured
  const secret = req.headers.get('x-cron-secret') || req.headers.get('authorization')?.replace('Bearer ', '');
  return !!secret && secret === cronSecret;
}

// Returns booking IDs that have already had a given comms type sent successfully.
// Use this to exclude already-contacted bookings — PostgREST doesn't support subqueries.
export async function getSentBookingIds(commsType: string): Promise<string[]> {
  const { data } = await supabase
    .from('comms_log')
    .select('booking_id')
    .eq('comms_type', commsType)
    .eq('status', 'sent');
  return (data || []).map((r: any) => r.booking_id).filter(Boolean);
}

export const BOOKING_QUERY = `
  id, status, trip_type, pickup_date, pickup_time,
  pickup_address, dropoff_address, distance_km, return_km,
  needs_review, notes, deposit_paid, payment_method,
  customers ( id, name, email, phone ),
  bikes ( bike_type, condition, make, model, year ),
  quotes (
    total_aud, version, accepted_at,
    base_rate, km_loaded, km_rate_loaded,
    condition_surcharge, multi_bike_discount,
    fuel_levy_amount
  )
`;
