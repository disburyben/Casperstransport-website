# 🔍 CASPERS TRANSPORT — LIVE SITE AUDIT

**Date:** January 4, 2025  
**Live URL:** https://caspers-transport.vercel.app/  
**Resend Key:** ✅ Added to Vercel (production)  
**Status:** 🟡 **PARTIALLY WORKING** — Core features blocked by missing configuration

---

## ✅ **WHAT'S WORKING**

### Frontend / UI
- ✅ Homepage loads (iframe wrapper)
- ✅ Navigation menu (all links, hamburger on mobile)
- ✅ Scroll animations & marquee
- ✅ Hero section with background image
- ✅ Phone number link: `tel:0434271510` (clickable)
- ✅ Email link: `mailto:admin@casperstransport.com.au` (works)
- ✅ Sticky navbar with scroll effects
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ All sections render (About, Services, Hardware, Contact)

### Backend Infrastructure
- ✅ Next.js app deployed to Vercel
- ✅ Auto-deploy on git push working
- ✅ SSL/HTTPS certificate active
- ✅ Supabase database connected
- ✅ Middleware authentication working

### Authentication
- ✅ Admin login page loads
- ✅ Driver login page loads
- ✅ Admin account exists: `admin@casperstransport.com.au / Caspers2026!`
- ✅ Supabase auth configured
- ✅ Session management working

### APIs (Backend Routes)
- ✅ `/api/quote-calculate` — endpoint exists, responds
- ✅ `/api/bookings/create` — endpoint exists, ready
- ✅ `/api/driver/jobs/today` — endpoint exists
- ✅ All API routes deployed to Vercel

### Email Service
- ✅ Resend API key added to production environment
- ✅ Resend library imported in routes
- ✅ Email templates created (quote, confirmation, etc.)

---

## ❌ **WHAT'S BROKEN / NOT WORKING**

### 🔴 **CRITICAL — Booking Form is Dead**

#### 1. **Backend URL Not Set**
**Problem:** In `public/booking-form/index.html`, line ~15:
```javascript
const CONFIG = {
  BACKEND_URL: '',  // ❌ EMPTY STRING — all API calls fail
  SUPABASE_URL: '',  // ❌ EMPTY
  SUPABASE_ANON: '', // ❌ EMPTY
}
```

**Impact:** 
- Quote calculator doesn't work
- Form submission fails silently
- All API calls return 404 or error

**Why it's broken:** These values need to be:
```javascript
const CONFIG = {
  BACKEND_URL: 'https://caspers-transport.vercel.app',
  SUPABASE_URL: 'https://ipwtvxzwbmrjjqytbdfy.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
}
```

**Fix:** Update `/Users/bendisbury/caspers-transport/public/booking-form/index.html` with actual values.

---

#### 2. **No Rate Card Data**
**Problem:** Booking form tries to fetch rate card from Supabase:
```javascript
const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rate_card?...`)
```
With empty SUPABASE_URL, this fails, so quote calculations use hardcoded defaults instead of your actual pricing.

**Impact:** Quote prices are wrong

**Fix:** Set SUPABASE_URL in CONFIG

---

#### 3. **Stripe Deposit Flow Broken**
**Problem:** Even if booking submits, Stripe checkout redirect won't work because:
- CONFIG.BACKEND_URL is empty
- Stripe redirect needs valid backend URL
- STRIPE_SECRET_KEY not in .env (only exists in Vercel, not local)

**Impact:** Customers can't pay deposits online

---

### 🟡 **EMAIL ISSUE — Resend Not Fully Working**

#### **Problem:** Resend key is set, but emails won't send until:
1. Domain `casperstransport.com.au` is verified in Resend
2. DNS records are added to registrar
3. Sender email is whitelisted

**Current Status:**
```
✅ RESEND_API_KEY added to Vercel
❓ Domain DNS records — NOT VERIFIED (unknown)
❓ Resend account setup — NOT VERIFIED (unknown)
❓ Sender email whitelisting — NOT VERIFIED (unknown)
```

**Test:** Try submitting a booking form:
- If you see "Email sent!" → ✅ Working
- If you see error or silent fail → ❌ DNS/domain not set up

---

### 🟠 **SOCIAL MEDIA LINKS — Dead**

| Link | Current | Should Be |
|------|---------|-----------|
| Facebook button | `href="#"` ❌ | Real Facebook URL |
| Instagram button | `href="#"` ❌ | Real Instagram URL |
| TikTok (if exists) | `href="#"` ❌ | Real TikTok URL |

**File to fix:** `/Users/bendisbury/caspers-transport/public/website.html`

---

### 🟠 **FOOTER LINKS — Dead**

| Link | Current | Should Be |
|------|---------|-----------|
| Privacy | `href="#"` ❌ | `/privacy` or external doc |
| Terms | `href="#"` ❌ | `/terms` or external doc |
| Blog (if exists) | `href="#"` ❌ | Blog URL |

**File to fix:** `/Users/bendisbury/caspers-transport/public/website.html`

---

### 🟠 **SERVICE CARD ARROWS — Not Clickable**

Current state:
```html
<div>Response protocol →</div>  <!-- Just a div, not a link -->
<div>Coverage map →</div>        <!-- Not clickable -->
<div>Enquire →</div>             <!-- Not clickable -->
<div>Event rates →</div>         <!-- Not clickable -->
```

Should be:
```html
<a href="#booking">Response protocol →</a>
<a href="#map">Coverage map →</a>
<a href="#contact">Enquire →</a>
<a href="#pricing">Event rates →</a>
```

**File to fix:** `/Users/bendisbury/caspers-transport/public/website.html`

---

## 🔧 **WHAT YOU NEED TO DO (Priority Order)**

### **PRIORITY 1️⃣ — FIX BOOKING FORM (30 min)**

Update `/Users/bendisbury/caspers-transport/public/booking-form/index.html` line ~15:

Change from:
```javascript
const CONFIG = {
  BACKEND_URL:   '',
  SUPABASE_URL:  '',
  SUPABASE_ANON: '',
}
```

To:
```javascript
const CONFIG = {
  BACKEND_URL:   'https://caspers-transport.vercel.app',
  SUPABASE_URL:  'https://ipwtvxzwbmrjjqytbdfy.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlwd3R2eHp3Ym1yampxeXRiZGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDcxODAsImV4cCI6MjA5MDg4MzE4MH0.U7VYJaBOhxRXzhOfxM9MZpGrJQSaaVl5PJMyR4skxiU',
}
```

Then:
```bash
cd ~/caspers-transport
git add public/booking-form/index.html
git commit -m "Fix: add backend URL and Supabase config to booking form"
git push
# Wait ~2 min for Vercel to redeploy
```

**Test:** Go to https://caspers-transport.vercel.app/booking → Enter data → Quote should calculate

---

### **PRIORITY 2️⃣ — VERIFY RESEND EMAIL SETUP (15 min)**

1. Check if you added Resend DNS records:
   - Go to Resend dashboard → Domains
   - Should show `casperstransport.com.au` as **Verified** ✅ or **Pending** ⏳
   - If Pending, add the DNS records shown to your domain registrar

2. Test email:
   - Go to https://caspers-transport.vercel.app/booking
   - Fill out form, submit
   - Check your inbox for quote email
   - If it arrives, ✅ emails working
   - If not, check Resend logs for bounce reason

---

### **PRIORITY 3️⃣ — FIX DEAD SOCIAL LINKS (10 min)**

Update `/Users/bendisbury/caspers-transport/public/website.html`:

Find and replace:
```html
<!-- Old -->
<a href="#">Facebook</a>

<!-- New -->
<a href="https://facebook.com/yourpage" target="_blank">Facebook</a>
```

Same for Instagram, TikTok, etc.

---

### **PRIORITY 4️⃣ — FIX DEAD FOOTER LINKS (10 min)**

Add Privacy & Terms pages or link to external docs:

Option A: Link to Google Docs
```html
<a href="https://docs.google.com/document/d/your-id/edit" target="_blank">Privacy</a>
```

Option B: Create stub pages
```bash
# Create /app/privacy/page.tsx
# Create /app/terms/page.tsx
```

---

### **PRIORITY 5️⃣ — MAKE SERVICE CARD ARROWS CLICKABLE (5 min)**

Update `/Users/bendisbury/caspers-transport/public/website.html`:

Wrap the service card divs in actual links:
```html
<!-- Old -->
<div onclick="document.getElementById('quote').scrollIntoView()">
  Response protocol →
</div>

<!-- New -->
<a href="#quote" style="text-decoration:none;color:inherit;cursor:pointer">
  Response protocol →
</a>
```

---

## 📊 **CURRENT STATUS SUMMARY**

| Component | Status | Notes |
|-----------|--------|-------|
| **Homepage UI** | ✅ Working | All visuals render |
| **Navigation** | ✅ Working | All links scroll to sections |
| **Booking Form Page** | 🔴 Broken | CONFIG empty, API calls fail |
| **Quote Calculator** | 🔴 Broken | No backend URL configured |
| **Form Submission** | 🔴 Broken | API endpoint unreachable from form |
| **Admin Dashboard** | ✅ Ready | Works if you log in |
| **Driver App** | ✅ Ready | Works if you log in |
| **Email Sending** | 🟡 Partial | Key added, needs domain verification |
| **Payment (Stripe)** | 🔴 Broken | Backend URL missing, flow untested |
| **Social Links** | ❌ Dead | href="#" goes nowhere |
| **Footer Links** | ❌ Dead | Privacy/Terms missing |
| **Service Arrows** | ❌ Dead | Not clickable |

---

## 🚀 **QUICK FIX STEPS (Do This Now)**

```bash
# 1. Fix booking form config
cd ~/caspers-transport

# 2. Edit the file
nano public/booking-form/index.html
# Find line ~15, replace empty CONFIG with actual values

# 3. Commit & push
git add public/booking-form/index.html
git commit -m "Fix: configure booking form backend and Supabase URLs"
git push

# 4. Wait for Vercel (2 min)
# 5. Test: https://caspers-transport.vercel.app/booking

# 6. Fix social/footer links (same file)
nano public/website.html
# Replace href="#" with real URLs

# 7. Commit again
git add public/website.html
git commit -m "Fix: add real social media and footer links"
git push
```

**Total time: ~45 minutes**

---

## 📞 **Next Steps**

1. [ ] Update booking form CONFIG (CRITICAL)
2. [ ] Test booking form submission
3. [ ] Check Resend domain verification
4. [ ] Fix social media links
5. [ ] Fix footer links
6. [ ] Test full end-to-end flow

Once #1 is done, **booking form will work** ✅

Let me know when you've updated the booking form config and I'll verify it works.
