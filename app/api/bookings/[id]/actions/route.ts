export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient }       from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { getResend }          from '@/lib/clients';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireAdmin(req: NextRequest) {
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => req.cookies.get(n)?.value, set: () => {}, remove: () => {} } }
  );
  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session) return null;
  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', session.user.id).single();
  return profile?.role === 'admin' ? session : null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = params;
  const body = await req.json();
  const { action } = body;

  if (action === 'mark_paid') {
    const { error } = await supabase
      .from('bookings')
      .update({ deposit_paid: true })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabase.from('comms_log').insert({
      booking_id: id, comms_type: 'admin_notification', status: 'sent',
      recipient: 'system', subject: 'Payment marked as received',
      sent_at: new Date().toISOString(),
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'assign_driver') {
    const { driver_id } = body;
    // Try to update driver_id — column may not exist yet, fail gracefully
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ driver_id })
        .eq('id', id);
      if (error) throw error;
      await supabase.from('comms_log').insert({
        booking_id: id, comms_type: 'admin_notification', status: 'sent',
        recipient: 'system', subject: `Driver assigned: ${driver_id}`,
        sent_at: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  if (action === 'send_confirmation') {
    // Fetch booking + customer
    const { data: booking, error: bErr } = await supabase
      .from('bookings')
      .select('*, customers(name, email, phone), bikes(make, model, year, bike_type, condition), quotes(total_aud)')
      .eq('id', id)
      .single();
    if (bErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const customer = (booking as any).customers;
    const bikes = (booking as any).bikes || [];
    const quote = ((booking as any).quotes || [])[0];
    const bikeStr = bikes.map((b: any) => `${b.make||''} ${b.model||''}`.trim() || b.bike_type).join(', ') || 'your bike';
    const dateStr = new Date((booking as any).pickup_date + 'T12:00:00').toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const timeStr = (booking as any).pickup_time ? formatTime24((booking as any).pickup_time) : 'to be confirmed';
    const totalStr = quote?.total_aud ? `A$${parseFloat(quote.total_aud).toFixed(2)}` : 'as quoted';

    await getResend().emails.send({
      from: 'Caspers Transport <bookings@casperstransport.com.au>',
      to: [customer.email],
      subject: 'Booking confirmed — Caspers Transport',
      html: buildConfirmationEmail({ customer, bikeStr, booking, dateStr, timeStr, totalStr }),
    });

    await supabase.from('comms_log').insert({
      booking_id: id, comms_type: 'booking_confirmed', status: 'sent',
      recipient: customer.email, subject: 'Booking confirmed — Caspers Transport',
      sent_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

function formatTime24(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function buildConfirmationEmail({ customer, bikeStr, booking, dateStr, timeStr, totalStr }: any) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0D0D0D;padding:20px 28px;">
        <span style="font-size:18px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
      </div>
      <div style="background:#EAF8FC;border-left:4px solid #4FC1DB;padding:14px 28px;font-size:15px;font-weight:600;color:#1A6B7A;">
        ✓ Your booking is confirmed
      </div>
      <div style="padding:28px;">
        <p style="font-size:17px;font-weight:600;margin:0 0 6px;">Hi ${customer.name.split(' ')[0]},</p>
        <p style="color:#666;margin:0 0 24px;font-size:15px;line-height:1.6;">
          Your bike transport has been confirmed. Here are your details:
        </p>
        <div style="background:#F5F5F4;border-radius:6px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#666;width:130px;">Bike(s)</td><td style="font-weight:600;">${bikeStr}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Collected from</td><td>${booking.pickup_address}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Delivering to</td><td>${booking.dropoff_address}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Date</td><td style="font-weight:600;">${dateStr}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Pickup time</td><td style="color:#4FC1DB;font-weight:600;">${timeStr}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Total</td><td>${totalStr}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#898880;line-height:1.6;">
          Please ensure the bike is accessible and ready at the agreed time.
          Questions? Reply to this email or call us directly.
        </p>
        <p style="font-size:14px;margin-top:20px;">— The Caspers Transport team</p>
      </div>
      <div style="background:#F5F5F4;padding:14px 28px;font-size:12px;color:#898880;text-align:center;">
        Caspers Transport · Roseworthy SA 5371 · <a href="mailto:admin@casperstransport.com.au" style="color:#4FC1DB;">admin@casperstransport.com.au</a>
      </div>
    </div>
  `;
}
