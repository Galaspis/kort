-- Kort: plain Postgres; no database-level auth or row-level security.
-- Identity comes from the hub login (Remote-Email); users are rows here, keyed by email.
-- IDs are UUIDs kept from the previous hosted database so recipe links and media paths survived the move.
create extension if not exists "pgcrypto";

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'המשפחה שלי',
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  household_id uuid references households (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  title text not null,
  description text,
  servings numeric,
  prep_minutes integer,
  cook_minutes integer,
  category text not null default 'אחר',
  cuisine text,
  difficulty text not null default 'בינוני',
  tags text[] not null default '{}',
  ingredients jsonb not null default '[]',
  steps jsonb not null default '[]',
  original_language text,
  confidence text,
  warnings text[] not null default '{}',
  source_url text,
  source_platform text not null default 'manual',
  video_url text,
  thumbnail_url text,
  author text,
  caption text,
  image_url text,
  notes text,
  rating smallint check (rating between 1 and 5),
  times_cooked integer not null default 0,
  is_favorite boolean not null default false,
  nutrition jsonb,
  kids_approved boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipes_household_idx on recipes (household_id, created_at desc);

create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  aisle text,
  checked boolean not null default false,
  recipe_id uuid references recipes (id) on delete set null,
  recipe_title text,
  created_at timestamptz not null default now()
);
create index if not exists shopping_household_idx on shopping_items (household_id, checked, aisle);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  source_url text,
  source_text text,
  status text not null default 'queued',
  progress text,
  error text,
  recipe_id uuid references recipes (id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists recipes_touch on recipes;
create trigger recipes_touch before update on recipes for each row execute function touch_updated_at();
drop trigger if exists import_jobs_touch on import_jobs;
create trigger import_jobs_touch before update on import_jobs for each row execute function touch_updated_at();

-- "Something changed" counter per household: the app polls it instead of a realtime subscription.
create table if not exists household_versions (
  household_id uuid primary key references households (id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
create or replace function bump_household_version() returns trigger language plpgsql as $$
declare h uuid;
begin
  h := coalesce(new.household_id, old.household_id);
  insert into household_versions (household_id, version, updated_at) values (h, 1, now())
    on conflict (household_id) do update set version = household_versions.version + 1, updated_at = now();
  return null;
end; $$;
drop trigger if exists recipes_bump on recipes;
create trigger recipes_bump after insert or update or delete on recipes for each row execute function bump_household_version();
drop trigger if exists shopping_bump on shopping_items;
create trigger shopping_bump after insert or update or delete on shopping_items for each row execute function bump_household_version();

-- ---------------------------------------------------------------------------
-- Shopping lists (added 2026-10-19): one list per shopping trip. Finished lists
-- stay as history; whatever was not bought rolls forward to the next list.
-- ---------------------------------------------------------------------------
create table if not exists shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  title text,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists shopping_lists_household_idx on shopping_lists (household_id, status, created_at);

alter table shopping_items add column if not exists list_id uuid references shopping_lists (id) on delete cascade;
alter table shopping_items add column if not exists unavailable boolean not null default false;
alter table shopping_items add column if not exists emoji text;
create index if not exists shopping_items_list_idx on shopping_items (list_id, checked);

-- One-time: items that predate lists go into a fresh open list per household.
insert into shopping_lists (household_id)
  select distinct i.household_id from shopping_items i
  where i.list_id is null
    and not exists (select 1 from shopping_lists l where l.household_id = i.household_id and l.status = 'open');
update shopping_items i
  set list_id = (select l.id from shopping_lists l where l.household_id = i.household_id and l.status = 'open' order by l.created_at limit 1)
  where i.list_id is null;

drop trigger if exists shopping_lists_bump on shopping_lists;
create trigger shopping_lists_bump after insert or update or delete on shopping_lists for each row execute function bump_household_version();

-- ---------------------------------------------------------------------------
-- Cooking course (added 2026-11-05): per-person lesson progress, and the
-- "why it works" notes the model writes for a recipe (cached on the recipe).
-- ---------------------------------------------------------------------------
create table if not exists learning_progress (
  user_id uuid not null references users (id) on delete cascade,
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  quiz_score integer,
  primary key (user_id, lesson_id)
);
alter table recipes add column if not exists why jsonb;

-- Daily lesson by email (added 2026-11-06): who wants it, and what was already sent.
alter table users add column if not exists daily_lesson_email boolean not null default false;
create table if not exists lesson_emails (
  user_id uuid not null references users (id) on delete cascade,
  lesson_id text not null,
  sent_at timestamptz not null default now()
);
create unique index if not exists lesson_emails_user_lesson_idx on lesson_emails (user_id, lesson_id);

-- Meal planner (added 2026-11-08): recipes or free-text lines placed on a day, meal and course.
create table if not exists meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  date date not null,
  meal text not null,
  course text not null default 'main',
  recipe_id uuid references recipes (id) on delete set null,
  title text,
  servings numeric,
  note text,
  position integer not null default 0,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meal_plans_household_date_idx on meal_plans (household_id, date);
drop trigger if exists meal_plans_touch on meal_plans;
create trigger meal_plans_touch before update on meal_plans for each row execute function touch_updated_at();
drop trigger if exists meal_plans_bump on meal_plans;
create trigger meal_plans_bump after insert or update or delete on meal_plans for each row execute function bump_household_version();
alter table meal_plans add column if not exists cooked_at timestamptz;
