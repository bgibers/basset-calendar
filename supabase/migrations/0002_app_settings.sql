create table public.app_settings (
  key text primary key,
  value text not null
);

-- current_year = the calendar year currently being sold (dates on the calendar),
-- not the wall-clock year. Bumping it in the admin dashboard is the entire yearly
-- rollover; readers fall back to (wall-clock year + 1) if this row is missing.
insert into public.app_settings (key, value) values ('current_year', '2027');

alter table public.app_settings enable row level security;
-- no policies: anon/authenticated get nothing; service role bypasses RLS (same as orders)
