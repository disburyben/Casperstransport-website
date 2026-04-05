// app/api/automation/reminders-2h/route.ts
// ============================================================
// 2-HOUR REMINDER — SMS via Twilio
// Fires every 30 minutes via Vercel Cron
// Finds confirmed bookings with pickup within the next 2–2.5 hours
// Sends a brief SMS to customer mobile
// ============================================================

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import {
  supabase, twilioClient, validateCronSecret,
  BOOKING_QUERY, TWILIO_FROM, CASPERS_PHONE, getSentBookingIds
} from '@/automation/triggers';

export async function POST(req: NextRequest) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now      = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Fetch today's confirmed bookings that haven't had a 2h SMS sent yet
  const sentIds = await getSentBookingIds('reminder_2h_sms');
  let query = supabase.from('bookings').select(BOOKING_QUERY)
    .eq('pickup_date', todayStr)
    .in('status', ['confirmed']);
  if (sentIds.length > 0) query = query.not('id', 'in', `(${sentIds.join(',')})`);
  const { data: bookings, error } = await query;

  if (error) {
    console.error('2h SMS reminder query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No SMS reminders needed right now' });
  }

  const results = [];

  for (const booking of bookings) {
    const customer = booking.customers as any;

    // Check if pickup time is within the 2h–2.5h window
    if (!booking.pickup_time) continue;

    const [h, m]       = booking.pickup_time.split(':').map(Number);
    const pickupMs     = new Date(booking.pickup_date + 'T00:00:00').getTime() + (h * 60 + m) * 60000;
    const diffMinutes  = (pickupMs - now.getTime()) / 60000;

    // Only send if pickup is between 110 and 150 minutes away (2h window, 30 min cron tolerance)
    if (diffMinutes < 110 || diffMinutes > 150) continue;

    try {
      const bikeStr = (booking.bikes as any[])?.[0]
        ? `${(booking.bikes as any[])[0].make || ''} ${(booking.bikes as any[])[0].model || ''}`.trim()
        : 'your bike';

      const timeStr = formatTime(booking.pickup_time);

      const smsBody = buildSMSBody({
        customerName: customer.name,
        bikeStr,
        pickupAddress: booking.pickup_address,
        timeStr,
        caspersPhone:  CASPERS_PHONE,
      });

      // Format AU mobile for Twilio: 04XX XXX XXX → +614XXXXXXXX
      const toNumber = formatAuMobile(customer.phone);
      if (!toNumber) {
        console.warn(`Invalid phone for booking ${booking.id}: ${customer.phone}`);
        continue;
      }

      await twilioClient.messages.create({
        body: smsBody,
        from: TWILIO_FROM,
        to:   toNumber,
      });

      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'reminder_2h_sms',
        status:     'sent',
        recipient:  toNumber,
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, customer: customer.name, to: toNumber, status: 'sent' });

    } catch (err: any) {
      console.error(`2h SMS failed for booking ${booking.id}:`, err);

      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'reminder_2h_sms',
        status:     'failed',
        recipient:  (booking.customers as any)?.phone || '',
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, status: 'failed', error: err.message });
    }
  }

  return NextResponse.json({
    sent: results.filter(r => r.status === 'sent').length,
    results,
  });
}

// ============================================================
// SMS BODY — kept short (under 160 chars where possible)
// ============================================================
function buildSMSBody({ customerName, bikeStr, pickupAddress, timeStr, caspersPhone }: {
  customerName: string;
  bikeStr:      string;
  pickupAddress: string;
  timeStr:      string;
  caspersPhone: string;
}) {
  // Abbreviate address for SMS length
  const shortAddr = pickupAddress.replace(', South Australia', '').replace(', SA', '').replace(/\s+\d{4}$/, '');

  return `Hi ${customerName.split(' ')[0]}, Caspers Transport heads your way at ${timeStr} to collect your ${bikeStr} from ${shortAddr}. Questions? Call ${caspersPhone}`;
}

// ============================================================
// HELPERS
// ============================================================
function formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function formatAuMobile(phone: string): string | null {
  // Strip spaces and non-digits
  const cleaned = phone.replace(/\D/g, '');
  // 04XXXXXXXX → +614XXXXXXXX
  if (cleaned.startsWith('04') && cleaned.length === 10) {
    return '+61' + cleaned.slice(1);
  }
  // Already international
  if (cleaned.startsWith('614') && cleaned.length === 11) {
    return '+' + cleaned;
  }
  return null;
}

// Vercel cron sends GET — alias to POST handler
export { POST as GET };
