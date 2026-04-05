// app/api/driver/me/route.ts — returns current driver info from cookie session
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { verifyDriverSession } from '@/lib/driver-auth';

export async function GET(req: NextRequest) {
  const token  = req.cookies.get('driver_token')?.value;
  const driver = await verifyDriverSession(token);

  if (!driver) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ driver });
}
