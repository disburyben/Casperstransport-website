// app/api/automation/review-requests/route.ts
// ============================================================
// REVIEW REQUEST — EMAIL
// Fires daily at 10:00 AM ACST
// Finds jobs completed exactly 3 days ago, invoice already sent
// Sends a brief, friendly review request with Google + Facebook links
// ============================================================

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import {
  supabase, resend, validateCronSecret,
  BOOKING_QUERY, FROM_EMAIL
} from '@/automation/triggers';

const GOOGLE_REVIEW_URL   = process.env.GOOGLE_REVIEW_URL   || 'https://g.page/r/YOUR_GOOGLE_REVIEW_LINK';
const FACEBOOK_REVIEW_URL = process.env.FACEBOOK_REVIEW_URL || 'https://www.facebook.com/Casperstransport';

export async function POST(req: NextRequest) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 3 days ago date string
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const targetDate = threeDaysAgo.toISOString().split('T')[0];

  // Find completed bookings from 3 days ago:
  // - Invoice already sent (completed + invoice in comms_log)
  // - Review request NOT yet sent
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(BOOKING_QUERY)
    .eq('status', 'completed')
    .eq('pickup_date', targetDate)
    .not('id', 'in', `(select booking_id from comms_log where comms_type = 'review_request_email' and status = 'sent')`)
    .filter('id', 'in', `(select booking_id from comms_log where comms_type = 'invoice_email' and status = 'sent')`);

  if (error) {
    console.error('Review request query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No review requests due today' });
  }

  const results = [];

  for (const booking of bookings) {
    try {
      const customer = booking.customers as any;
      const bikes    = booking.bikes    as any[];

      const bikeStr = bikes?.[0]
        ? `${bikes[0].make || ''} ${bikes[0].model || ''}`.trim() || 'your bike'
        : 'your bike';

      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      [customer.email],
        subject: `How did we do, ${customer.name.split(' ')[0]}?`,
        html:    buildReviewEmail({ customer, bikeStr, booking }),
      });

      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'review_request_email',
        status:     'sent',
        recipient:  customer.email,
        subject:    `How did we do, ${customer.name.split(' ')[0]}?`,
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, customer: customer.name, status: 'sent' });

    } catch (err: any) {
      console.error(`Review request failed for booking ${booking.id}:`, err);

      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'review_request_email',
        status:     'failed',
        recipient:  (booking.customers as any)?.email || '',
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
// REVIEW EMAIL TEMPLATE — Brief and personal
// ============================================================
function buildReviewEmail({ customer, bikeStr, booking }: any) {
  const firstName = customer.name.split(' ')[0];
  const routeStr  = `${booking.pickup_address?.replace(', South Australia', '').replace(', SA', '').split(',')[0]} → ${booking.dropoff_address?.replace(', South Australia', '').replace(', SA', '').split(',')[0]}`;

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">

      <div style="background:#0D0D0D;padding:20px 28px;">
        <span style="font-size:18px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
      </div>

      <div style="padding:32px;">
        <p style="font-size:17px;font-weight:600;margin:0 0 12px;">Hi ${firstName},</p>

        <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 16px;">
          We hope ${bikeStr} arrived safe and sound on the ${routeStr} run.
          It was great looking after it for you.
        </p>

        <p style="font-size:15px;color:#444;line-height:1.7;margin:0 0 24px;">
          If you've got a couple of minutes, we'd really appreciate a quick review —
          it helps other riders find us and keeps the business going.
        </p>

        <!-- CTA buttons -->
        <div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap;">
          <a href="${GOOGLE_REVIEW_URL}"
            style="display:inline-block;background:#4FC1DB;color:white;padding:13px 28px;border-radius:6px;font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.02em;">
            ★ Leave a Google Review
          </a>
          <a href="${FACEBOOK_REVIEW_URL}"
            style="display:inline-block;background:#0D0D0D;color:white;padding:13px 28px;border-radius:6px;font-weight:700;font-size:15px;text-decoration:none;letter-spacing:0.02em;">
            Facebook Review
          </a>
        </div>

        <p style="font-size:13px;color:#898880;line-height:1.6;margin:0 0 8px;">
          Even one sentence makes a big difference. Thanks for trusting us with your ride.
        </p>

        <p style="font-size:14px;color:#444;margin:0;">
          — The Caspers Transport team
        </p>
      </div>

      <div style="background:#F5F5F4;padding:14px 28px;font-size:12px;color:#898880;text-align:center;">
        To unsubscribe from future emails, reply with "unsubscribe".<br>
        Caspers Transport · Roseworthy SA 5371 · <a href="mailto:admin@casperstransport.com.au" style="color:#4FC1DB;">admin@casperstransport.com.au</a>
      </div>
    </div>
  `;
}

// Vercel cron sends GET — alias to POST handler
export { POST as GET };
