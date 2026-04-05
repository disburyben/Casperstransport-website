// app/api/driver/pin-auth/route.ts
// POST { pin: '1234' } → validates PIN, sets driver_token cookie, returns driver info

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashPin } from '@/lib/driver-auth';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SESSION_HOURS = 12;

export async function POST(req: NextRequest) {
  const { pin } = await req.json();

  if (!pin || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 400 });
  }

  const pinHash = hashPin(pin);

  const { data: driver } = await supabase
    .from('drivers')
    .select('id, name, vehicle, phone, active')
    .eq('pin_hash', pinHash)
    .eq('active', true)
    .single();

  if (!driver) {
    // Consistent timing to prevent enumeration
    await new Promise(r => setTimeout(r, 400));
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });
  }

  // Create session token
  const token     = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();

  await supabase.from('driver_sessions').insert({
    driver_id:  driver.id,
    token,
    expires_at: expiresAt,
  });

  // Clean up old sessions for this driver
  await supabase
    .from('driver_sessions')
    .delete()
    .eq('driver_id', driver.id)
    .lt('expires_at', new Date().toISOString());

  const res = NextResponse.json({
    success: true,
    driver: { id: driver.id, name: driver.name },
  });

  res.cookies.set('driver_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   SESSION_HOURS * 60 * 60,
    path:     '/',
  });

  return res;
}
