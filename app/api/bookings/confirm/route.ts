export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing booking ID' }, { status: 400 });

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, pickup_address, dropoff_address, pickup_date, payment_method')
    .eq('id', id)
    .single();

  if (error || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  if (booking.status === 'confirmed' || booking.status === 'in_transit' || booking.status === 'completed') {
    return NextResponse.json({ error: 'Already confirmed', booking }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed' })
    .eq('id', id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Log the confirmation
  await supabase.from('comms_log').insert({
    booking_id: id,
    comms_type: 'booking_confirmed',
    status: 'sent',
    recipient: 'customer',
    sent_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, booking });
}
