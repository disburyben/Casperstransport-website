// Shared invoice email builders used by both automation cron and admin manual send

export interface BizDetails {
  abn:         string | null;
  bankName:    string | null;
  bankBsb:     string | null;
  bankAccount: string | null;
}

export function buildInvoiceEmail({
  booking, customer, bikes, quote,
  invoiceNum, invoiceDate, bizDetails,
}: any) {
  const bikeRows = bikes.map((b: any, i: number) => {
    const name = `${b.make || ''} ${b.model || ''} ${b.year || ''}`.trim() ||
      `${(b.bike_type || '').replace(/_/g, ' ')} (Bike ${i + 1})`;
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #EEEEEC;">${name}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EEEEEC;color:#666;">${(b.condition || '').replace(/_/g, ' ')}</td>
    </tr>`;
  }).join('');

  const pickupDateFormatted = new Date(booking.pickup_date + 'T12:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const base      = parseFloat(quote.base_rate          || 120).toFixed(2);
  const kmCost    = (parseFloat(quote.km_loaded || 0) * parseFloat(quote.km_rate_loaded || 0)).toFixed(2);
  const kmReturn  = (parseFloat(quote.km_return || 0) * parseFloat(quote.km_rate_return || 0)).toFixed(2);
  const condS     = parseFloat(quote.condition_surcharge || 0).toFixed(2);
  const disc      = parseFloat(quote.multi_bike_discount || 0).toFixed(2);
  const fuel      = parseFloat(quote.fuel_levy_amount    || 0).toFixed(2);
  const calculated = parseFloat(base) + parseFloat(kmCost) + parseFloat(kmReturn) + parseFloat(condS) - parseFloat(disc) + parseFloat(fuel);
  const total   = (parseFloat(quote.total_aud) > 0 ? parseFloat(quote.total_aud) : calculated).toFixed(2);
  const deposit = booking.deposit_paid ? (parseFloat(total) * 0.2).toFixed(2) : '0.00';
  const balance = (parseFloat(total) - parseFloat(deposit)).toFixed(2);

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff;">
      <div style="background:#0D0D0D;padding:24px 32px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:20px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
        <span style="font-size:13px;color:#5C5C58;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Tax Invoice</span>
      </div>
      <div style="padding:32px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;">
          <div>
            <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 4px;">Invoice number</p>
            <p style="font-size:18px;font-weight:700;color:#0D0D0D;margin:0;">${invoiceNum}</p>
          </div>
          <div style="text-align:right;">
            <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 4px;">Invoice date</p>
            <p style="font-size:14px;font-weight:600;color:#0D0D0D;margin:0;">${invoiceDate}</p>
          </div>
        </div>
        <div style="margin-bottom:24px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 6px;">Bill to</p>
          <p style="font-size:15px;font-weight:600;margin:0 0 2px;">${customer.name}</p>
          <p style="font-size:13px;color:#666;margin:0;">${customer.email}</p>
          <p style="font-size:13px;color:#666;margin:0;">${customer.phone || ''}</p>
        </div>
        <div style="background:#F5F5F4;border-radius:6px;padding:18px;margin-bottom:24px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 10px;">Job summary</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:5px 0;color:#666;width:130px;">Service date</td><td style="font-weight:500;">${pickupDateFormatted}</td></tr>
            <tr><td style="padding:5px 0;color:#666;">Collected from</td><td>${booking.pickup_address}</td></tr>
            <tr><td style="padding:5px 0;color:#666;">Delivered to</td><td>${booking.dropoff_address}</td></tr>
            ${booking.distance_km ? `<tr><td style="padding:5px 0;color:#666;">Distance</td><td>${booking.distance_km} km</td></tr>` : ''}
          </table>
          <div style="margin-top:14px;border-top:1px solid #E8E7E5;padding-top:12px;">
            <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 8px;">Bike(s) transported</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">${bikeRows}</table>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <thead>
            <tr style="border-bottom:2px solid #0D0D0D;">
              <th style="text-align:left;padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Description</th>
              <th style="text-align:right;padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Base call-out fee</td><td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${base}</td></tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Transport — loaded run${booking.distance_km ? ` <span style="font-size:12px;color:#898880;">(${booking.distance_km} km)</span>` : ''}</td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${kmCost}</td>
            </tr>
            ${parseFloat(kmReturn) > 0 ? `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Return run${booking.return_km ? ` <span style="font-size:12px;color:#898880;">(${booking.return_km} km)</span>` : ''}</td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${kmReturn}</td>
            </tr>` : ''}
            ${parseFloat(condS) > 0 ? `<tr><td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Condition surcharge</td><td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${condS}</td></tr>` : ''}
            ${parseFloat(disc)  > 0 ? `<tr><td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Multi-bike discount</td><td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;color:#1A7A4A;">−A$${disc}</td></tr>` : ''}
            ${parseFloat(fuel)  > 0 ? `<tr><td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Fuel levy</td><td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${fuel}</td></tr>` : ''}
          </tbody>
          <tfoot>
            <tr>
              <td style="padding:12px 0 4px;font-weight:700;font-size:16px;">Total (inc. GST)</td>
              <td style="text-align:right;padding:12px 0 4px;font-weight:700;font-size:20px;color:#4FC1DB;">A$${total}</td>
            </tr>
            ${parseFloat(deposit) > 0 ? `
            <tr><td style="padding:4px 0;color:#666;font-size:13px;">Deposit paid</td><td style="text-align:right;padding:4px 0;color:#1A7A4A;font-size:13px;">−A$${deposit}</td></tr>
            <tr><td style="padding:4px 0;font-weight:700;">Balance due</td><td style="text-align:right;padding:4px 0;font-weight:700;font-size:16px;">A$${balance}</td></tr>` : ''}
          </tfoot>
        </table>
        ${parseFloat(balance) > 0 ? `
        <div style="background:#EAF8FC;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#337D8E;">
          <strong>Balance of A$${balance} is due on receipt.</strong> Please EFT to the account details below, or call us to arrange payment.
        </div>` : `
        <div style="background:#EAF5EE;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#1A7A4A;">
          <strong>Paid in full. Thank you!</strong>
        </div>`}
        ${parseFloat(balance) > 0 ? `
        <div style="background:#F5F5F4;border-radius:6px;padding:16px 18px;margin-bottom:20px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 10px;">Payment details</p>
          <table style="font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:3px 0;color:#666;width:120px;">Bank</td><td style="font-weight:500;">${bizDetails.bankName || 'Contact us for bank details'}</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Account name</td><td style="font-weight:500;">Caspers Transport</td></tr>
            <tr><td style="padding:3px 0;color:#666;">BSB</td><td style="font-weight:500;">${bizDetails.bankBsb || '—'}</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Account no.</td><td style="font-weight:500;">${bizDetails.bankAccount || '—'}</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Reference</td><td style="font-weight:500;">${invoiceNum}</td></tr>
          </table>
        </div>` : ''}
        <div style="border-top:1px solid #E8E7E5;padding-top:16px;font-size:12px;color:#898880;line-height:1.7;">
          <strong style="color:#0D0D0D;">Caspers Transport</strong><br>
          ${bizDetails.abn ? `ABN: ${bizDetails.abn}<br>` : ''}
          Roseworthy SA 5371<br>
          <a href="mailto:admin@casperstransport.com.au" style="color:#4FC1DB;">admin@casperstransport.com.au</a>
        </div>
      </div>
    </div>
  `;
}

export function buildReminderEmail({
  customer, invoiceNum, invoiceDate, total, balance, bizDetails, daysOverdue,
}: {
  customer:    { name: string; email: string; phone?: string };
  invoiceNum:  string;
  invoiceDate: string;
  total:       string;
  balance:     string;
  bizDetails:  BizDetails;
  daysOverdue: number;
}) {
  const urgency = daysOverdue >= 14
    ? `<div style="background:#FEF3C7;border-left:4px solid #D97706;border-radius:4px;padding:12px 16px;margin-bottom:20px;font-size:14px;color:#92400E;">
        <strong>This invoice is now ${daysOverdue} days overdue.</strong> Please arrange payment as soon as possible, or get in touch if there's a problem.
       </div>`
    : `<div style="background:#EAF8FC;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#337D8E;">
        Just a friendly reminder that the balance on this invoice is still outstanding.
       </div>`;

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff;">
      <div style="background:#0D0D0D;padding:24px 32px;">
        <span style="font-size:20px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
      </div>
      <div style="padding:32px;">
        <p style="font-size:18px;font-weight:600;margin:0 0 6px;">Hi ${customer.name},</p>
        <p style="color:#666;margin:0 0 24px;">Hope you're well. We're getting in touch about the following invoice.</p>

        <div style="background:#F5F5F4;border-radius:6px;padding:18px;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#666;width:140px;">Invoice number</td><td style="font-weight:700;">${invoiceNum}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Invoice date</td><td>${invoiceDate}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Total</td><td>A$${total}</td></tr>
            <tr><td style="padding:6px 0;color:#666;">Balance due</td><td style="font-weight:700;font-size:16px;color:#4FC1DB;">A$${balance}</td></tr>
          </table>
        </div>

        ${urgency}

        <div style="background:#F5F5F4;border-radius:6px;padding:16px 18px;margin-bottom:24px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 10px;">Payment details</p>
          <table style="font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:3px 0;color:#666;width:120px;">Bank</td><td style="font-weight:500;">${bizDetails.bankName || 'Contact us for bank details'}</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Account name</td><td style="font-weight:500;">Caspers Transport</td></tr>
            <tr><td style="padding:3px 0;color:#666;">BSB</td><td style="font-weight:500;">${bizDetails.bankBsb || '—'}</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Account no.</td><td style="font-weight:500;">${bizDetails.bankAccount || '—'}</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Reference</td><td style="font-weight:500;">${invoiceNum}</td></tr>
          </table>
        </div>

        <p style="font-size:14px;color:#444;margin:0 0 8px;">
          If you've already paid, please ignore this message — it may have crossed in the mail. Otherwise, please transfer the balance at your earliest convenience using the details above.
        </p>
        <p style="font-size:14px;color:#444;margin:0 0 24px;">
          Any questions? Give us a call or reply to this email and we'll sort it out.
        </p>

        <div style="border-top:1px solid #E8E7E5;padding-top:16px;font-size:12px;color:#898880;line-height:1.7;">
          <strong style="color:#0D0D0D;">Caspers Transport</strong><br>
          ${bizDetails.abn ? `ABN: ${bizDetails.abn}<br>` : ''}
          Roseworthy SA 5371 &nbsp;|&nbsp;
          <a href="tel:0434271510" style="color:#4FC1DB;">0434 271 510</a> &nbsp;|&nbsp;
          <a href="mailto:admin@casperstransport.com.au" style="color:#4FC1DB;">admin@casperstransport.com.au</a>
        </div>
      </div>
    </div>
  `;
}

export function makeInvoiceNumber(bookingId: string): string {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `INV-${ym}-${bookingId.slice(-4).toUpperCase()}`;
}
