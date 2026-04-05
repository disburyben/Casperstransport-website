// app/api/driver/logout/route.ts
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const token = req.cookies.get('driver_token')?.value;

  if (token) {
    await supabase.from('driver_sessions').delete().eq('token', token);
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set('driver_token', '', { maxAge: 0, path: '/' });
  return res;
}
