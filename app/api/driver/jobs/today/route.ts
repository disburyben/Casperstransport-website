export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyDriverSession } from '@/lib/driver-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const token  = req.cookies.get('driver_token')?.value;
  const driver = await verifyDriverSession(token);
  if (!driver) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = new Date().toISOString().split('T')[0];

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id, status, pickup_date, pickup_time,
      pickup_address, dropoff_address,
      distance_km, return_km, notes,
      customers ( name, phone ),
      bikes ( bike_type, condition, make, model, year, notes )
    `)
    .eq('pickup_date', today)
    .in('status', ['confirmed', 'in_transit'])
    .order('pickup_time', { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobs      = (bookings || []).map((b, i) => ({ ...b, order: i + 1 }));
  const totalKm   = jobs.reduce((a: number, j: any) => a + (j.distance_km || 0), 0);
  const totalBikes = jobs.reduce((a: number, j: any) => a + ((j.bikes as any[])?.length || 0), 0);

  return NextResponse.json({
    jobs,
    summary: { totalJobs: jobs.length, totalKm, totalBikes, driverName: driver.name },
  });
}
