create table public.orders (
  id uuid primary key default gen_random_uuid(),
  calendar_date date not null,
  owner_name text not null default '',
  city text not null default '',
  state text not null default '',
  email text not null default '',
  dog_name text not null default '',
  is_rescue boolean not null default false,
  caption text not null default '',
  image_url text,
  thumb_url text,
  stand_option text check (stand_option in ('have-black','have-clear','ordered')),
  stand_option_source text check (stand_option_source in ('customer','admin')),
  stand_token uuid not null unique default gen_random_uuid(),
  stand_emails_sent int not null default 0,
  stand_last_emailed_at timestamptz,
  source text not null check (source in ('migrated','web')),
  created_at timestamptz not null default now()
);
-- deliberately NO unique constraint on calendar_date (Feb 11 2027 has two legit rows)
create index orders_calendar_date_idx on public.orders (calendar_date);
create index orders_stand_token_idx on public.orders (stand_token);
alter table public.orders enable row level security;
-- no policies: anon/authenticated get nothing; service role bypasses RLS
