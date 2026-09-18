-- NovaBalance Health — orders + subscribers
-- Run once in the Supabase SQL Editor for the `novabalance` project.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- orders
-- Written only by the stripe_webhook function, using the service-role key.
-- stripe_session_id is unique so a webhook delivered twice cannot duplicate a row.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id                    bigint generated always as identity primary key,
  created_at            timestamptz not null default now(),
  stripe_session_id     text not null unique,
  stripe_payment_intent text,
  email                 text,
  customer_name         text,
  amount_subtotal       integer,          -- cents
  amount_discount       integer default 0,-- cents
  amount_shipping       integer default 0,-- cents
  amount_total          integer,          -- cents
  currency              text default 'usd',
  items                 jsonb,            -- [{ id, qty }]
  shipping_address      jsonb,
  status                text not null default 'paid',
  fulfilled_at          timestamptz,
  notes                 text
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_email_idx      on public.orders (email);
create index if not exists orders_status_idx     on public.orders (status);

-- ---------------------------------------------------------------------------
-- subscribers
-- Email captured on the NFC verification page, plus the single-use promotion
-- code minted for that address in Stripe.
-- ---------------------------------------------------------------------------
create table if not exists public.subscribers (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  email          text not null unique,
  discount_code  text,
  source         text default 'nfc_verify',
  redeemed_at    timestamptz,
  unsubscribed   boolean not null default false
);

create index if not exists subscribers_created_at_idx on public.subscribers (created_at desc);
create index if not exists subscribers_code_idx       on public.subscribers (discount_code);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Both tables hold personal data: customer names, shipping addresses, emails.
-- RLS is enabled with NO permissive policy, so the anon and authenticated keys
-- can read nothing at all. The Netlify functions use the service-role key, which
-- bypasses RLS by design. Never expose the service-role key to the browser.
-- ---------------------------------------------------------------------------
alter table public.orders      enable row level security;
alter table public.subscribers enable row level security;

-- Explicitly revoke the API roles' table grants as a second layer, so a future
-- accidental "allow all" policy still would not be enough on its own.
revoke all on public.orders      from anon, authenticated;
revoke all on public.subscribers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Convenience view for reading the order book by hand in the SQL editor.
-- Amounts are converted from cents to dollars for readability.
-- ---------------------------------------------------------------------------
create or replace view public.orders_readable as
select
  id,
  created_at at time zone 'America/Los_Angeles' as placed_at_pt,
  status,
  email,
  customer_name,
  round(amount_total    / 100.0, 2) as total_usd,
  round(amount_discount / 100.0, 2) as discount_usd,
  round(amount_shipping / 100.0, 2) as shipping_usd,
  items,
  shipping_address,
  stripe_session_id
from public.orders
order by created_at desc;

revoke all on public.orders_readable from anon, authenticated;
