// lib/clients.ts
// Lazy-initialized clients to avoid build-time errors when env vars missing

import { Resend } from 'resend';
import Stripe from 'stripe';

let _resend: Resend | null = null;

export function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend((process.env.RESEND_API_KEY || 're_test_placeholder').trim());
  }
  return _resend;
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
      apiVersion: '2024-06-20',
    });
  }
  return _stripe;
}
