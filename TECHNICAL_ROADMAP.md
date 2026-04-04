# Caspers Transport — TECHNICAL RECOMMENDATIONS & UPDATES

## 🏗️ ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                    CASPERS TRANSPORT STACK                   │
├─────────────────────────────────────────────────────────────┤
│ Frontend:     Next.js 14 (React + TypeScript)                │
│ Hosting:      Vercel (Edge Functions, CDN, Auto-Deploy)      │
│ Database:     Supabase (PostgreSQL + Real-Time)              │
│ Auth:         Supabase Auth (Email/Password)                 │
│ Storage:      Supabase Storage (PDFs, Signatures)            │
│ Email:        Resend (Transactional)                         │
│ Payments:     Stripe (Optional, Deposits)                    │
│ SMS:          Twilio (Optional, Reminders)                   │
│ Routing:      OpenStreetMap / Google Maps (Distance calc)    │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ CURRENT FEATURES

### ✅ **Public Booking System**
- Quote calculator (real-time pricing)
- Bike condition surcharge logic
- Multi-bike discounts
- Payment method selection (Stripe deposit / Follow-up)
- Quote email to customer + admin notification

### ✅ **Admin Dashboard**
- Bookings overview (pending, confirmed, in-transit, completed)
- Calendar view
- Customer management
- Job sheet generation (PDF)
- Communications log
- Analytics (revenue, bookings trend)

### ✅ **Driver Mobile App**
- Today's jobs list
- Navigation to pickup/dropoff
- Job status tracking (Confirmed → In Transit → Completed)
- Customer signature capture (pickup + dropoff)
- Distance tracking (km summary)

### ✅ **Automation**
- 24-hour pickup reminders (SMS via Twilio)
- 2-hour pre-pickup reminders
- Invoice generation (on completion)
- Review requests (3 days post-delivery)
- All triggered by Vercel Cron Jobs

---

## 🎯 RECOMMENDED IMPROVEMENTS (Priority Order)

### **HIGH PRIORITY** (Next 2 weeks)

#### 1. **User Role Management UI**
**Why:** Currently, creating drivers requires manual Supabase access  
**What:** Add an "Drivers" page in admin dashboard to:
- List active drivers
- Add new drivers (generates auth user + profile)
- Edit driver details
- Suspend/reactivate drivers
- Reset passwords

**Effort:** ~4 hours  
**Files to update:**
- New route: `app/api/admin/drivers/route.ts` (CRUD endpoints)
- New page: `app/admin/drivers/page.tsx` (React component)
- Add nav link in admin layout

---

#### 2. **Email Template Customization**
**Why:** Current templates are hard-coded, can't easily change brand colors/messaging  
**What:** Move email templates to Supabase and allow admin to customize:
- Quote email subject/body
- Confirmation email
- Reminder SMS templates
- Invoice email template

**Effort:** ~3 hours  
**Implementation:**
- New table: `email_templates` (template_type, subject, html_body)
- New admin page: Settings → Email Templates
- Update email routes to fetch from DB instead of hard-coded

---

#### 3. **Real-Time Job Updates**
**Why:** Driver app requires page refresh to see updated job status  
**What:** Use Supabase Real-Time subscriptions:
- When admin changes booking status → driver sees it instantly
- When driver updates status → admin sees it immediately

**Effort:** ~2 hours  
**Implementation:**
- Add `useEffect` hook in driver.html to subscribe to `bookings` changes
- Add subscription in admin dashboard to jobs table

---

### **MEDIUM PRIORITY** (Next 1 month)

#### 4. **Payment Tracking Dashboard**
**Why:** No visibility into unpaid deposits  
**What:** Add admin page showing:
- Pending deposits (invoices sent, not paid)
- Paid deposits (with payment dates)
- Overdue payments
- Deposit reconciliation

**Effort:** ~5 hours  
**Tables needed:**
- `invoices` (booking_id, amount, due_date, paid_date, stripe_payment_id)

---

#### 5. **SMS & Email Analytics**
**Why:** Can't see if customers are opening/clicking emails, SMS delivery rates  
**What:** Track:
- Email open rates (via Resend webhooks)
- SMS delivery/failure (via Twilio webhooks)
- Click-through rates (quote links)
- Unsubscribe management

**Effort:** ~4 hours  
**Implementation:**
- New tables: `email_events`, `sms_events`
- Webhooks: `/api/webhooks/resend`, `/api/webhooks/twilio`
- Analytics page in admin

---

#### 6. **Stripe Checkout Improvements**
**Why:** Current checkout is minimal  
**What:**
- Show bike details in Stripe checkout
- Add discount codes / promo system
- Payment plan option (deposit + final payment on delivery)
- Automated invoice from Stripe

**Effort:** ~6 hours

---

#### 7. **Geographic Heat Map**
**Why:** Admin can't see where bookings are geographically  
**What:** Add map view in admin dashboard showing:
- All bookings plotted (color-coded by status)
- Driver locations (live if GPS enabled)
- Route density visualization
- Coverage gaps

**Effort:** ~5 hours  
**Library:** `react-leaflet` + Supabase geospatial

---

### **NICE-TO-HAVE** (Next 2 months)

#### 8. **Multi-Driver Scheduling**
**Why:** Currently no conflict detection when assigning jobs to drivers  
**What:**
- Calendar view per driver (shows their schedule)
- Auto-suggest next available driver
- Conflict warnings (overlapping time slots)
- Driver capacity management

**Effort:** ~8 hours

---

#### 9. **Customer Portal**
**Why:** Customers can't view their own bookings/invoices  
**What:** Self-service portal where customers can:
- View booking status + history
- Track driver location (live)
- Download invoices
- Message admin
- Leave reviews

**Effort:** ~10 hours

---

#### 10. **Mobile App (React Native)**
**Why:** Driver app is web-only; offline support would be helpful  
**What:** React Native app with:
- Works offline (sync when back online)
- GPS tracking (with consent)
- Offline signature capture
- Battery optimization

**Effort:** ~40 hours

---

#### 11. **Integration with Accounting Software**
**Why:** Manual invoice entry to MYOB/Xero  
**What:**
- MYOB/Xero API integration
- Auto-sync completed jobs as invoices
- Track payments in accounting software

**Effort:** ~6 hours (depends on API complexity)

---

#### 12. **Multi-Location Support**
**Why:** Currently assumes pickup from "Roseworthy" only  
**What:**
- Add location management (warehouse A, B, C)
- Distance calculation from nearest location
- Driver assignment by location
- Location-specific rate cards

**Effort:** ~10 hours

---

## 🛡️ SECURITY & PERFORMANCE RECOMMENDATIONS

### Security

- [ ] **Rate Limiting:** Add rate limits to booking/auth endpoints (prevent spam)
  - Library: `@vercel/rate-limit` or custom middleware
  - Effort: 1 hour

- [ ] **CORS Configuration:** Explicitly allow only your domain
  - Current: Open (works but not ideal)
  - Update: `middleware.ts` with strict CORS headers
  - Effort: 30 min

- [ ] **Audit Logging:** Log all admin actions (bookings changed, drivers added, emails sent)
  - New table: `audit_log`
  - Effort: 2 hours

- [ ] **Password Policy:** Enforce strong passwords + 2FA for admin
  - Supabase supports TOTP 2FA
  - Effort: 1 hour (configuration)

- [ ] **Secrets Rotation:** Change STRIPE_WEBHOOK_SECRET, CRON_SECRET quarterly
  - Set calendar reminder
  - Update Vercel env vars

### Performance

- [ ] **Image Optimization:** Add Next.js Image component for logos/bike photos
  - Current: HTML `<img>` (not optimized)
  - Effort: 1 hour

- [ ] **Database Query Optimization:**
  - Add indexes on `bookings(status)`, `bookings(pickup_date)`
  - Use pagination for large result sets
  - Effort: 2 hours

- [ ] **Caching Strategy:**
  - Cache rate card (rarely changes)
  - Cache customer lookups (avoid repeated queries)
  - Implement with Supabase caching or Redis
  - Effort: 3 hours

- [ ] **Bundle Size Analysis:**
  - Run: `npm run build` → check `.next/static/` size
  - Goal: Keep < 200KB (currently ~87KB ✅)

---

## 🚨 KNOWN ISSUES & WORKAROUNDS

| Issue | Impact | Workaround | Fix Effort |
|-------|--------|-----------|-----------|
| No offline mode for driver app | Driver loses data if connection drops | Implement service worker caching | 4 hours |
| Signature images not compressed | Large PDFs | Add image compression before upload | 1 hour |
| No push notifications | Drivers don't get alerts | Use Supabase Real-Time + browser notifications | 2 hours |
| Distance calculation rough (linear) | Inaccurate quotes | Use Google Maps Distance Matrix API | 2 hours |
| No retry logic for failed emails | Some emails might not send | Add queue system (Bull/RabbitMQ) | 6 hours |

---

## 📊 ANALYTICS TO TRACK

Add Google Analytics 4 to measure:

```typescript
// Key metrics
- Booking conversion rate (landing → form submit → payment)
- Average quote value
- Quote-to-confirmation time
- Driver app active sessions
- Job completion rate
- Customer satisfaction (via review requests)
```

**Setup:** 30 min (add GA4 script to layout.tsx)

---

## 🔗 USEFUL RESOURCES

- **Next.js Docs:** https://nextjs.org/docs
- **Supabase Docs:** https://supabase.com/docs
- **Vercel Docs:** https://vercel.com/docs
- **Stripe Docs:** https://stripe.com/docs/api
- **Resend Docs:** https://resend.com/docs
- **Twilio Docs:** https://www.twilio.com/docs

---

## 📝 CODE QUALITY CHECKLIST

- [ ] All TypeScript types fully typed (no `any` beyond disabled ESLint)
- [ ] All API routes have proper error handling
- [ ] All database queries have RLS policies
- [ ] All user inputs are validated (frontend + backend)
- [ ] All sensitive data encrypted (API keys in env only)
- [ ] All routes have proper logging
- [ ] Unit tests for critical functions (quote calculation, auth)

---

## 🚀 DEPLOYMENT BEST PRACTICES

1. **Always test locally first:** `npm run dev` before push
2. **Use feature branches:** `git checkout -b feature/xyz`
3. **Code review:** Have another developer check before merge
4. **Staging environment:** Add a Vercel Preview environment for QA
5. **Database backups:** Use Supabase automated backups (daily)
6. **Monitor errors:** Set up Sentry or Vercel Error Tracking
7. **Performance:** Use Vercel Analytics dashboard

---

## 🎓 LEARNING RESOURCES FOR YOUR TEAM

- React/TypeScript: https://react-typescript-cheatsheet.netlify.app/
- Next.js Best Practices: https://vercel.com/docs/best-practices
- Database Design: https://www.postgresql.org/docs/
- API Design: https://restfulapi.net/

---

**Last Updated:** 2025-01-02  
**Maintained By:** Your Development Team
