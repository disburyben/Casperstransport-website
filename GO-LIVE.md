# Caspers Transport — GO-LIVE CHECKLIST

**Current Status:** ✅ **APP DEPLOYED** (live at https://caspers-transport.vercel.app)

---

## 🚀 IMMEDIATE NEXT STEPS (This Week)

### 1️⃣ **Connect Custom Domain** (10 min)
- [ ] Go to https://vercel.com/benjamins-projects-426fb7d2/caspers-transport/settings
- [ ] In **Domains**, add `casperstransport.com.au`
- [ ] Update your domain registrar's DNS to point to Vercel (Vercel will show you exact records)
- [ ] Verify domain is active (usually takes 5-30 min)

### 2️⃣ **Get Real API Keys** (30 min each)

#### Resend (Email Service)
- [ ] Sign up at https://resend.com
- [ ] Create a new API key
- [ ] Add to Vercel: `npx vercel env add RESEND_API_KEY production --scope benjamins-projects-426fb7d2`
- [ ] Paste the key and confirm
- [ ] **Test:** Submit a booking form — check your email for the quote

#### Stripe (Optional Now / Later)
If you want deposits/payments online:
- [ ] Sign up at https://stripe.com (use your AU bank account)
- [ ] Get **Secret Key** and **Webhook Secret**
- [ ] Add to Vercel:
  ```bash
  npx vercel env add STRIPE_SECRET_KEY production --scope benjamins-projects-426fb7d2
  npx vercel env add STRIPE_WEBHOOK_SECRET production --scope benjamins-projects-426fb7d2
  ```
- [ ] Configure webhook endpoint in Stripe dashboard: `https://casperstransport.com.au/api/webhooks/stripe`
- [ ] Events to listen: `checkout.session.completed`

#### Twilio (SMS Reminders)
If you want automatic 24-hour and 2-hour pickup reminders:
- [ ] Sign up at https://twilio.com
- [ ] Buy an AU phone number
- [ ] Get **Account SID** and **Auth Token**
- [ ] Add to Vercel:
  ```bash
  npx vercel env add TWILIO_ACCOUNT_SID production --scope benjamins-projects-426fb7d2
  npx vercel env add TWILIO_AUTH_TOKEN production --scope benjamins-projects-426fb7d2
  npx vercel env add TWILIO_FROM_NUMBER production --scope benjamins-projects-426fb7d2
  npx vercel env add CASPERS_PHONE_NUMBER production --scope benjamins-projects-426fb7d2
  ```

### 3️⃣ **Set Cron Secret** (Security)
- [ ] Generate a random secure string (e.g., `openssl rand -hex 32`)
- [ ] Add to Vercel:
  ```bash
  npx vercel env add CRON_SECRET production --scope benjamins-projects-426fb7d2
  ```
- [ ] This protects your automation endpoints (reminders, invoices) from unauthorized access

### 4️⃣ **Create Driver Accounts** (10 min per driver)
- [ ] Go to https://supabase.com/dashboard/project/ipwtvxzwbmrjjqytbdfy/auth/users
- [ ] Click **Add user** → Create new user
- [ ] Email: driver's email (e.g., jake@example.com)
- [ ] Password: auto-generate or set custom
- [ ] Click **Create**
- [ ] Go to https://supabase.com/dashboard/project/ipwtvxzwbmrjjqytbdfy/editor/user_profiles
- [ ] Add a row for each driver:
  - `id`: Match the UUID from auth.users
  - `name`: Driver's name
  - `role`: `driver`
  - `email`: Driver's email
- [ ] Test: Visit https://caspers-transport.vercel.app/driver/login and log in with driver credentials

---

## ✅ TESTING BEFORE FULL LAUNCH

### Public Booking Form
1. [ ] Visit https://caspers-transport.vercel.app/booking
2. [ ] Fill form: 2 bikes, realistic pickup/dropoff addresses
3. [ ] Select **Follow-up** payment (fastest to test)
4. [ ] Submit
5. [ ] Check:
   - [ ] You receive a quote email (Resend key required)
   - [ ] Admin receives notification email
   - [ ] Booking appears in admin dashboard

### Admin Dashboard
1. [ ] Visit https://caspers-transport.vercel.app/admin
2. [ ] Log in: `admin@casperstransport.com.au` / `Caspers2026!`
3. [ ] Check:
   - [ ] Today's bookings display correctly
   - [ ] All tabs work (Bookings, Calendar, Customers, Analytics)
   - [ ] Can view booking details and edit

### Driver App
1. [ ] Visit https://caspers-transport.vercel.app/driver/login
2. [ ] Log in with a driver account you created
3. [ ] Check:
   - [ ] Today's jobs load
   - [ ] Can tap "Picked up" to mark job in transit
   - [ ] Can capture signature (test pickup/dropoff sigs)
   - [ ] Can mark job complete

### Automation (Optional, Test Friday)
Once cron secret is set:
- [ ] Reminders trigger at scheduled times (check Vercel Logs)
- [ ] Invoices email to admin
- [ ] Review requests go out to customers 3 days after delivery

---

## 📋 PRODUCTION ENVIRONMENT CHECKLIST

### Environment Variables (All Required for Full Functionality)
```
✅ NEXT_PUBLIC_SUPABASE_URL        (already set)
✅ NEXT_PUBLIC_SUPABASE_ANON_KEY   (already set)
✅ SUPABASE_SERVICE_ROLE_KEY       (already set)
⏳ RESEND_API_KEY                  (needed for emails)
⏳ STRIPE_SECRET_KEY               (optional, for deposits)
⏳ STRIPE_WEBHOOK_SECRET           (optional, for deposits)
⏳ TWILIO_ACCOUNT_SID              (optional, for SMS reminders)
⏳ TWILIO_AUTH_TOKEN               (optional, for SMS reminders)
⏳ TWILIO_FROM_NUMBER              (optional, for SMS reminders)
⏳ CASPERS_PHONE_NUMBER            (optional, for customer SMS)
⏳ CRON_SECRET                     (needed for automation security)
✅ NEXT_PUBLIC_APP_URL             (already set to casperstransport.com.au)
```

### Supabase Database
- [ ] RLS policies are set (fixes applied)
- [ ] Admin user created with `role: admin`
- [ ] At least 1 driver created with `role: driver`
- [ ] Rate card configured (pricing rules)

### DNS & SSL
- [ ] Custom domain configured in Vercel
- [ ] SSL certificate auto-issued (free)
- [ ] DNS records pointing to Vercel
- [ ] HTTPS working on casperstransport.com.au

### Monitoring
- [ ] Vercel dashboard: https://vercel.com/benjamins-projects-426fb7d2/caspers-transport
  - [ ] Monitor deployments
  - [ ] Check error logs if issues occur
- [ ] Supabase dashboard: https://supabase.com/dashboard/project/ipwtvxzwbmrjjqytbdfy
  - [ ] Monitor database queries
  - [ ] Check auth users

---

## 🔄 DEPLOYMENT WORKFLOW

### After Making Code Changes:
```bash
cd ~/caspers-transport
git add -A
git commit -m "Your change description"
git push
# Vercel auto-deploys to production ~2 min after push
```

### Viewing Live Logs:
```bash
vercel logs --prod --scope benjamins-projects-426fb7d2
```

### Rollback (if needed):
Go to https://vercel.com/benjamins-projects-426fb7d2/caspers-transport → Deployments → click a previous deployment → Promote to Production

---

## 🆘 TROUBLESHOOTING

### Booking Form Not Sending Emails
- [ ] Check `RESEND_API_KEY` is set in Vercel
- [ ] Check Resend dashboard for bounced emails
- [ ] Verify sender email is verified in Resend

### Drivers Can't Log In
- [ ] Check user exists in https://supabase.com/dashboard/project/ipwtvxzwbmrjjqytbdfy/auth/users
- [ ] Check user_profiles table has matching row with `role: driver`
- [ ] Check RLS policies on user_profiles (should be fixed)

### Admin Dashboard Blank/Loading
- [ ] Hard refresh (Cmd+Shift+R)
- [ ] Check browser console (F12) for errors
- [ ] Verify admin user has `role: admin` in Supabase

### Stripe Deposits Not Working
- [ ] Webhook endpoint registered in Stripe dashboard
- [ ] STRIPE_WEBHOOK_SECRET matches exactly in Vercel
- [ ] Check Stripe webhook delivery logs

---

## 📚 LIVE URLs

| Page | URL |
|------|-----|
| **Public Website** | https://caspers-transport.vercel.app |
| **Booking Form** | https://caspers-transport.vercel.app/booking |
| **Admin Dashboard** | https://caspers-transport.vercel.app/admin |
| **Admin Login** | https://caspers-transport.vercel.app/admin/login |
| **Driver App** | https://caspers-transport.vercel.app/driver |
| **Driver Login** | https://caspers-transport.vercel.app/driver/login |

---

## 🎯 NICE-TO-HAVES (Post-Launch)

- [ ] Add social media links (Facebook, Google reviews)
- [ ] SEO optimization (meta tags, structured data)
- [ ] Analytics (Google Analytics, Vercel Analytics)
- [ ] Custom error pages (404, 500)
- [ ] Email templates refinement
- [ ] Dark mode toggle
- [ ] Mobile app (React Native)

---

## 📞 SUPPORT

**Vercel Issues:** https://vercel.com/help  
**Supabase Issues:** https://supabase.com/docs  
**Resend Issues:** https://resend.com/docs  
**Stripe Issues:** https://stripe.com/docs

---

**Generated:** 2025-01-02  
**App Status:** ✅ Deployed & Ready for Configuration
