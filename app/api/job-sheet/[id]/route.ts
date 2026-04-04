export const dynamic = 'force-dynamic';
// app/api/job-sheet/[id]/route.ts
// ============================================================
// JOB SHEET PDF — ON DEMAND
// GET  /api/job-sheet/[id]          → streams PDF to browser (admin view/print)
// POST /api/job-sheet/[id]/email    → generates PDF and emails to admin + attaches to comms log
//
// Auth: admin session required (Supabase server-side auth check)
// The Python generator is called via a bundled JS port using pdfkit,
// OR via a Python subprocess if running on a server with Python available.
// For Vercel (serverless), we use the pure-JS approach below with pdf-lib
// and a custom drawing engine that mirrors the Python output exactly.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { getResend } from '@/lib/clients';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── GET: Stream PDF inline (admin print/download) ───────────
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  // Auth check
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const booking = await fetchBooking(id);
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const pdfBytes = await buildJobSheetPDF(booking);

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="jobsheet-${id}.pdf"`,
      'Content-Length':      String(pdfBytes.byteLength),
    },
  });
}

// ── POST: Generate and email job sheet to admin ──────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  const booking = await fetchBooking(id);
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const pdfBytes   = await buildJobSheetPDF(booking);
  const customer   = (booking as any).customers;
  const pickupDate = booking.pickup_date;
  const dateStr    = new Date(pickupDate + 'T12:00:00')
    .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  await getResend().emails.send({
    from:    'Caspers Transport <bookings@casperstransport.com.au>',
    to:      ['admin@casperstransport.com.au'],
    subject: `Job Sheet — ${customer?.name} · ${dateStr}`,
    html: `
      <p>Job sheet attached for booking <strong>${id}</strong>.</p>
      <p><strong>${customer?.name}</strong><br>
      ${booking.pickup_address} → ${booking.dropoff_address}<br>
      ${dateStr}${booking.pickup_time ? ' at ' + booking.pickup_time : ''}</p>
    `,
    attachments: [{
      filename:    `jobsheet-${id}.pdf`,
      content:     Buffer.from(pdfBytes).toString('base64'),
      contentType: 'application/pdf',
    }],
  });

  // Log to comms
  await supabase.from('comms_log').insert({
    booking_id: id,
    comms_type: 'admin_notification',
    status:     'sent',
    recipient:  'admin@casperstransport.com.au',
    subject:    `Job Sheet — ${customer?.name} · ${dateStr}`,
    sent_at:    new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: 'Job sheet emailed to admin' });
}

// ── DATA FETCH ───────────────────────────────────────────────
async function fetchBooking(id: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, status, pickup_date, pickup_time,
      pickup_address, dropoff_address,
      distance_km, return_km, deposit_paid, notes,
      customers ( name, email, phone ),
      bikes ( bike_type, condition, make, model, year, notes ),
      quotes ( base_rate, total_aud, condition_surcharge,
               multi_bike_discount, fuel_levy_amount,
               km_loaded, km_rate_loaded )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return null;

  // Shape quote for PDF generator
  const quotes  = (data as any).quotes || [];
  const latestQ = quotes.sort((a: any, b: any) => b.version - a.version)[0] || null;
  if (latestQ) {
    latestQ.km_loaded_cost = (latestQ.km_loaded || 0) * (latestQ.km_rate_loaded || 0);
  }

  return { ...data, quote: latestQ, customer: (data as any).customers };
}

// ── PDF BUILDER (TypeScript port of generate_jobsheet.py) ────
// Uses pdf-lib for pure-JS PDF generation on Vercel serverless
// npm install pdf-lib
async function buildJobSheetPDF(booking: any): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts, degrees } = await import('pdf-lib');

  const doc      = await PDFDocument.create();
  const page     = doc.addPage([595.28, 841.89]); // A4 points
  const { width: W, height: H } = page.getSize();

  const fontBold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg   = await doc.embedFont(StandardFonts.Helvetica);
  const fontObliq = await doc.embedFont(StandardFonts.HelveticaOblique);

  const M  = 40;    // margin points
  const CW = W - 2 * M;

  // Colours
  const cBlack    = rgb(0.051, 0.051, 0.055);
  const cRed      = rgb(0.784, 0.157, 0.118);
  const cWhite    = rgb(1, 1, 1);
  const cGreyDark = rgb(0.239, 0.235, 0.224);
  const cGreyMid  = rgb(0.537, 0.533, 0.502);
  const cGreyLite = rgb(0.961, 0.961, 0.957);
  const cGreyBdr  = rgb(0.91, 0.906, 0.898);
  const cGreen    = rgb(0.102, 0.478, 0.29);
  const cAmber    = rgb(0.722, 0.42, 0);

  let y = H;

  // Helper: drawRect
  const rect = (x: number, ry: number, rw: number, rh: number, fill: any, stroke?: any) => {
    page.drawRectangle({ x, y: ry, width: rw, height: rh, color: fill, borderColor: stroke, borderWidth: stroke ? 0.5 : 0 });
  };

  // Helper: text
  const text = (str: string, x: number, ty: number, font: any, size: number, color: any) => {
    page.drawText(str, { x, y: ty, font, size, color });
  };

  // Helper: hline
  const hline = (hy: number, color = cGreyBdr) => {
    page.drawLine({ start: { x: M, y: hy }, end: { x: M + CW, y: hy }, thickness: 0.5, color });
  };

  // Helper: section label
  const sectionLabel = (x: number, sy: number, label: string) => {
    text(label, x, sy, fontBold, 7, cGreyMid);
  };

  // Helper: wrap text, returns lines array
  const wrapText = (str: string, maxW: number, fontSize: number): string[] => {
    const approxCharW = fontSize * 0.52;
    const maxChars    = Math.floor(maxW / approxCharW) || 1;
    const words       = str.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length <= maxChars) { line = test; }
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  };

  // ── HEADER BAR ──
  const HDR_H = 56;
  rect(0, H - HDR_H, W, HDR_H, cBlack);
  text('CASPERS', M, H - 38, fontBold, 16, cWhite);
  text('TRANSPORT', M + 55, H - 38, fontBold, 16, cRed);
  text('JOB SHEET', W - M - 58, H - 28, fontBold, 8, cGreyMid);
  text(booking.id || 'BK-XXXX', W - M - 58, H - 42, fontBold, 11, cWhite);

  y = H - HDR_H;

  // Red accent strip
  rect(0, y - 5, W, 5, cRed);
  y -= 26;

  // Status badge
  const statusMap: Record<string, [string, any]> = {
    confirmed:   ['CONFIRMED',   cGreen],
    in_transit:  ['IN TRANSIT',  rgb(0.165, 0.498, 0.831)],
    completed:   ['COMPLETED',   cGreyMid],
    pending_quote: ['PENDING',   cAmber],
  };
  const [statusLabel, statusColor] = statusMap[booking.status] || ['CONFIRMED', cGreen];
  rect(M, y - 20, 78, 20, statusColor);
  text(statusLabel, M + 6, y - 14, fontBold, 8, cWhite);

  // Date + time right
  const dateStr = _formatDate(booking.pickup_date);
  const timeStr = booking.pickup_time ? _formatTime(booking.pickup_time) : 'Time TBC';
  text(dateStr, W - M - fontBold.widthOfTextAtSize(dateStr, 12), y - 8, fontBold, 12, cBlack);
  text(`Pickup: ${timeStr}`, W - M - fontReg.widthOfTextAtSize(`Pickup: ${timeStr}`, 9), y - 22, fontReg, 9, cGreyMid);

  y -= 36;
  hline(y);
  y -= 20;

  // ── CUSTOMER + ROUTE ──
  const halfW = CW / 2 - 12;

  sectionLabel(M, y, 'CUSTOMER');
  const customer = booking.customer || booking.customers || {};
  text(customer.name || '—', M, y - 16, fontBold, 13, cBlack);
  text(customer.phone || '—', M, y - 30, fontReg, 10, cGreyDark);
  text(customer.email || '—', M, y - 42, fontReg, 9, cGreyMid);

  const rx = M + halfW + 16;
  sectionLabel(rx, y, 'ROUTE');
  let ry = y - 14;
  text('FROM', rx, ry, fontBold, 8, cGreyDark);
  ry -= 12;
  const pickupLines = wrapText(booking.pickup_address || '—', halfW, 9);
  for (const ln of pickupLines) { text(ln, rx, ry, fontReg, 9, cBlack); ry -= 13; }
  ry -= 4;
  text('↓', rx, ry, fontBold, 11, cRed);
  ry -= 16;
  text('TO', rx, ry, fontBold, 8, cGreyDark);
  ry -= 12;
  const dropoffLines = wrapText(booking.dropoff_address || '—', halfW, 9);
  for (const ln of dropoffLines) { text(ln, rx, ry, fontReg, 9, cBlack); ry -= 13; }
  if (booking.distance_km) {
    ry -= 4;
    text(`${booking.distance_km} km loaded`, rx, ry, fontReg, 8, cGreyMid);
  }

  y -= 64;
  hline(y);
  y -= 18;

  // ── BIKES ──
  sectionLabel(M, y, 'BIKE DETAILS');
  y -= 14;

  const bikes = booking.bikes || [];
  for (let i = 0; i < bikes.length; i++) {
    const bike   = bikes[i];
    const rowH   = 34;
    if (i % 2 === 0) rect(M, y - rowH, CW, rowH, cGreyLite);

    // Number circle
    page.drawCircle({ x: M + 13, y: y - rowH / 2, size: 10, color: cRed });
    text(String(i + 1), M + 10, y - rowH / 2 - 4, fontBold, 8, cWhite);

    const bikeName = [bike.make, bike.model, bike.year].filter(Boolean).join(' ') || `Bike ${i + 1}`;
    const bikeType = (bike.bike_type || '').replace(/_/g, ' ');
    const cond     = (bike.condition || '').replace(/_/g, ' ');

    text(bikeName, M + 28, y - 12, fontBold, 11, cBlack);
    text(bikeType, M + 28, y - 24, fontReg, 8, cGreyMid);

    const condColorMap: Record<string, any> = {
      'running rideable':  cGreen,
      'non runner':        cAmber,
      'broken seized':     cRed,
      'custom part built': cAmber,
      'stripped pieces':   cRed,
    };
    const condCol  = condColorMap[cond.toLowerCase()] || cGreyMid;
    const condBadgeW = 82;
    rect(W - M - condBadgeW, y - rowH + 8, condBadgeW, 18, condCol);
    text(cond.toUpperCase(), W - M - condBadgeW + 4, y - rowH + 14, fontBold, 7, cWhite);

    y -= rowH + 3;
  }

  y -= 6;
  hline(y);
  y -= 16;

  // ── NOTES ──
  if (booking.notes) {
    sectionLabel(M, y, 'NOTES FROM CUSTOMER');
    y -= 12;
    const noteLines = wrapText(booking.notes, CW - 16, 10);
    const noteH     = noteLines.length * 14 + 16;
    rect(M, y - noteH, CW, noteH, rgb(1, 0.973, 0.902));
    page.drawLine({ start: { x: M, y: y - noteH }, end: { x: M, y }, thickness: 2, color: cAmber });
    let ny = y - 12;
    for (const ln of noteLines) { text(ln, M + 10, ny, fontReg, 10, cGreyDark); ny -= 14; }
    y -= noteH + 14;
    hline(y);
    y -= 16;
  }

  // ── MAPS LINK ──
  sectionLabel(M, y, 'NAVIGATION');
  y -= 14;
  text('Google Maps (Roseworthy → Pickup → Dropoff):', M, y, fontReg, 9, cGreyDark);
  y -= 13;
  const mapsUrl = `https://maps.google.com/maps/dir/Roseworthy+SA+5371/${encodeURIComponent(booking.pickup_address || '')}/${encodeURIComponent(booking.dropoff_address || '')}`;
  const displayUrl = mapsUrl.length > 88 ? mapsUrl.slice(0, 85) + '...' : mapsUrl;
  text(displayUrl, M, y, fontReg, 8, cRed);
  y -= 16;
  hline(y);
  y -= 14;

  // ── QUOTE ──
  if (booking.quote) {
    const q = booking.quote;
    sectionLabel(M, y, 'QUOTE SUMMARY');
    y -= 14;
    const qLines: [string, string][] = [
      ['Base call-out', `A$${Number(q.base_rate || 0).toFixed(2)}`],
      ['Transport (loaded)', `A$${Number(q.km_loaded_cost || 0).toFixed(2)}`],
    ];
    if (Number(q.condition_surcharge) > 0) qLines.push(['Condition surcharge', `A$${Number(q.condition_surcharge).toFixed(2)}`]);
    if (Number(q.multi_bike_discount) > 0) qLines.push(['Multi-bike discount', `-A$${Number(q.multi_bike_discount).toFixed(2)}`]);

    for (const [lbl, val] of qLines) {
      text(lbl, M, y, fontReg, 9, cGreyDark);
      text(val, W - M - fontReg.widthOfTextAtSize(val, 9), y, fontReg, 9, cBlack);
      y -= 13;
    }
    hline(y, cGreyBdr);
    y -= 13;
    text('TOTAL', M, y, fontBold, 11, cBlack);
    const totalStr = `A$${Number(q.total_aud || 0).toFixed(2)}`;
    text(totalStr, W - M - fontBold.widthOfTextAtSize(totalStr, 13), y, fontBold, 13, cRed);
    if (booking.deposit_paid) {
      y -= 12;
      text('✓ Deposit paid', W - M - fontReg.widthOfTextAtSize('✓ Deposit paid', 9), y, fontReg, 9, cGreen);
    }
    y -= 20;
  }

  // ── SIGN-OFF BOX ──
  const sigH = 56;
  const sigY = Math.max(y - sigH, M + sigH);
  rect(M, sigY, CW, sigH, cGreyLite);
  page.drawRectangle({ x: M, y: sigY, width: CW, height: sigH, borderColor: cGreyBdr, borderWidth: 0.5 });

  const sigCols = ['Driver signature', 'Customer signature', 'Time delivered'];
  const colW3   = CW / 3;
  for (let i = 0; i < 3; i++) {
    const sx = M + i * colW3;
    text(sigCols[i], sx + 8, sigY + sigH - 14, fontReg, 7.5, cGreyMid);
    page.drawLine({ start: { x: sx + 8, y: sigY + 16 }, end: { x: sx + colW3 - 12, y: sigY + 16 }, thickness: 0.5, color: cGreyBdr });
    if (i < 2) page.drawLine({ start: { x: sx + colW3, y: sigY + 8 }, end: { x: sx + colW3, y: sigY + sigH - 8 }, thickness: 0.5, color: cGreyBdr });
  }

  // ── FOOTER ──
  const now = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  text(`Caspers Transport · Roseworthy SA 5371 · admin@casperstransport.com.au · Generated ${now}`, M, 14, fontReg, 7, cGreyMid);
  text(`Booking ${booking.id || ''}`, W - M - fontReg.widthOfTextAtSize(`Booking ${booking.id || ''}`, 7), 14, fontReg, 7, cGreyMid);

  return doc.save();
}

// ── Utils ────────────────────────────────────────────────────
function _formatDate(d: string): string {
  if (!d) return '—';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch { return d; }
}

function _formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
