// lib/driver-auth.ts
// Shared driver PIN auth helpers used by API routes and middleware.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export function hashPin(pin: string): string {
  const salt = process.env.CRON_SECRET || 'caspers-driver-salt';
  return crypto.createHash('sha256').update(salt + pin).digest('hex');
}

export interface DriverSession {
  driverId: string;
  name: string;
  vehicle: string | null;
  phone: string | null;
}

// Verifies driver_token cookie and returns driver info, or null if invalid.
export async function verifyDriverSession(token: string | undefined): Promise<DriverSession | null> {
  if (!token) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: session } = await supabase
    .from('driver_sessions')
    .select('driver_id, expires_at, drivers ( name, vehicle, phone, active )')
    .eq('token', token)
    .single();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const driver = session.drivers as any;
  if (!driver || !driver.active) return null;

  return {
    driverId: session.driver_id,
    name:     driver.name,
    vehicle:  driver.vehicle,
    phone:    driver.phone,
  };
}
