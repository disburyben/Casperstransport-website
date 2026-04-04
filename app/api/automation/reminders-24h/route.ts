// app/api/automation/reminders-24h/route.ts
// ============================================================
// 24-HOUR REMINDER — EMAIL
// Fires daily at 6:00 PM ACST (08:30 UTC)
// Finds all confirmed bookings with pickup_date = tomorrow
// Sends reminder email to customer with full booking summary
// ============================================================

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import {
  supabase, resend, validateCronSecret,
  BOOKING_QUERY, FROM_EMAIL, APP_URL, ADMIN_EMAIL
} from '@/automation/triggers';

export async function POST(req: NextRequest) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tomorrow in Adelaide time (ACST = UTC+9:30, ACDT = UTC+10:30)
  // Using UTC+9:30 as safe base — adjust if needed for daylight saving
  const now      = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(now.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

  // Fetch all confirmed bookings for tomorrow that haven't had a 24h reminder sent
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(BOOKING_QUERY)
    .eq('pickup_date', tomorrowStr)
    .in('status', ['confirmed', 'in_transit'])
    .not('id', 'in', `(
      select booking_id from comms_log
      where comms_type = 'reminder_24h_email'
      and status = 'sent'
    )`);

  if (error) {
    console.error('24h reminder query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No reminders needed today' });
  }

  const results = [];

  for (const booking of bookings) {
    try {
      const customer = booking.customers as any;
      const bikes    = booking.bikes    as any[];
      const quote    = (booking.quotes  as any[])?.[0];

      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      [customer.email],
        subject: `Reminder: Your bike pickup is tomorrow`,
        html:    build24hReminderEmail({ booking, customer, bikes, quote }),
      });

      // Log to comms_log
      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'reminder_24h_email',
        status:     'sent',
        recipient:  customer.email,
        subject:    'Reminder: Your bike pickup is tomorrow',
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, customer: customer.name, status: 'sent' });

    } catch (err: any) {
      console.error(`24h reminder failed for booking ${booking.id}:`, err);

      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'reminder_24h_email',
        status:     'failed',
        recipient:  (booking.customers as any)?.email || '',
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, status: 'failed', error: err.message });
    }
  }

  console.log(`24h reminders: ${results.filter(r => r.status === 'sent').length} sent, ${results.filter(r => r.status === 'failed').length} failed`);
  return NextResponse.json({ sent: results.filter(r => r.status === 'sent').length, results });
}

// ============================================================
// EMAIL TEMPLATE
// ============================================================
function build24hReminderEmail({ booking, customer, bikes, quote }: any) {
  const bikesSummary = bikes.map((b: any) =>
    `${b.make || ''} ${b.model || ''} ${b.year || ''}`.trim() ||
    (b.bike_type || '').replace(/_/g, ' ')
  ).join(', ');

  const dateFormatted = new Date(booking.pickup_date + 'T12:00:00').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const timeStr = booking.pickup_time
    ? formatTime(booking.pickup_time)
    : 'Time to be confirmed — our driver will be in touch';

  const totalStr = quote?.total_aud
    ? `A$${parseFloat(quote.total_aud).toFixed(2)}`
    : 'As quoted';

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0D0D0D;padding:20px 28px;">
        <span style="font-size:18px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
      </div>

      <div style="background:#FFF8E6;border-left:4px solid #D4880A;padding:14px 28px;font-size:14px;font-weight:600;color:#7A4F00;">
        ⏰ Your pickup is tomorrow
      </div>

      <div style="padding:28px;">
        <p style="font-size:17px;font-weight:600;margin:0 0 6px;">Hi ${customer.name},</p>
        <p style="color:#666;margin:0 0 24px;font-size:15px;">
          Just a reminder that we're collecting your bike tomorrow. Here are your booking details:
        </p>

        <div style="background:#F5F5F4;border-radius:6px;padding:20px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr>
              <td style="padding:6px 0;color:#666;width:130px;vertical-align:top;">Bike(s)</td>
              <td style="font-weight:600;padding:6px 0;">${bikesSummary}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666;vertical-align:top;">Pickup from</td>
              <td style="padding:6px 0;">${booking.pickup_address}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666;vertical-align:top;">Delivering to</td>
              <td style="padding:6px 0;">${booking.dropoff_address}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666;">Date</td>
              <td style="font-weight:600;padding:6px 0;">${dateFormatted}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666;">Pickup time</td>
              <td style="font-weight:600;color:#4FC1DB;padding:6px 0;">${timeStr}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#666;">Total</td>
              <td style="padding:6px 0;">${totalStr}</td>
            </tr>
          </table>
        </div>

        <div style="background:#0D0D0D;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#5C5C58;">Driver contact</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:white;">
            <a href="tel:${APP_URL ? process.env.CASPERS_PHONE_NUMBER || '' : ''}" style="color:#4FC1DB;text-decoration:none;">${process.env.CASPERS_PHONE_NUMBER || 'Call our office'}</a>
          </p>
          <p style="margin:4px 0 0;font-size:12px;color:#5C5C58;">Call or text if you need to make any changes</p>
        </div>

        ${booking.notes ? `
        <div style="background:#FFF8E6;border-radius:6px;padding:14px 16px;margin-bottom:20px;font-size:14px;color:#7A4F00;">
          <strong>Notes on file:</strong> ${booking.notes}
        </div>` : ''}

        <p style="font-size:13px;color:#898880;margin:0;line-height:1.6;">
          Please ensure the bike is accessible and ready for loading at the agreed time.
          If access details have changed, reply to this email or call us straight away.
        </p>
      </div>

      <div style="background:#F5F5F4;padding:16px 28px;text-align:center;font-size:12px;color:#898880;">
        Caspers Transport · South Australia · <a href="mailto:admin@casperstransport.com.au" style="color:#4FC1DB;">admin@casperstransport.com.au</a>
      </div>
    </div>
  `;
}

function formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}
