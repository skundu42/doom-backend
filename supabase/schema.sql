-- Doomscroll backend schema for Supabase Postgres
-- Apply in Supabase SQL editor or via migration tool.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text,
  avatar_url text,
  is_creator boolean not null default true,
  links text[] not null default '{}',
  interests text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 800),
  topic text not null default 'general',
  location text,
  hashtags text[] not null default '{}',
  media_type text not null check (media_type in ('image', 'video')),
  media_url text not null,
  thumbnail_url text,
  cloudflare_uid text,
  like_count integer not null default 0 check (like_count >= 0),
  bookmark_count integer not null default 0 check (bookmark_count >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  share_count integer not null default 0 check (share_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger posts_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

create index if not exists posts_feed_idx on public.posts(created_at desc, id desc);
create index if not exists posts_author_idx on public.posts(author_id, created_at desc, id desc);
create index if not exists posts_topic_idx on public.posts(topic, created_at desc, id desc);
create unique index if not exists posts_cloudflare_uid_uidx on public.posts(cloudflare_uid) where cloudflare_uid is not null;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists comments_post_created_idx on public.comments(post_id, created_at desc, id desc);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, user_id)
);

create table if not exists public.post_saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_idx on public.post_likes(user_id, created_at desc);
create index if not exists post_saves_user_idx on public.post_saves(user_id, created_at desc);

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  token text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, token)
);

create trigger device_tokens_updated_at
before update on public.device_tokens
for each row execute function public.set_updated_at();

create table if not exists public.video_uploads (
  uid text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  duration_seconds integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger video_uploads_updated_at
before update on public.video_uploads
for each row execute function public.set_updated_at();

drop trigger if exists like_count_trigger on public.post_likes;
drop trigger if exists save_count_trigger on public.post_saves;
drop trigger if exists comment_count_trigger on public.comments;

drop function if exists public.on_like_changed();
drop function if exists public.on_save_changed();
drop function if exists public.on_comment_changed();
drop function if exists public.refresh_like_count(uuid);
drop function if exists public.refresh_save_count(uuid);
drop function if exists public.refresh_comment_count(uuid);

create or replace function public.toggle_post_like(
  p_post_id uuid,
  p_user_id uuid,
  p_like boolean
)
returns boolean
language plpgsql
as $$
declare
  did_change boolean := false;
begin
  if p_like then
    insert into public.post_likes (post_id, user_id)
    values (p_post_id, p_user_id)
    on conflict do nothing;

    did_change := found;
    if did_change then
      update public.posts
      set like_count = like_count + 1
      where id = p_post_id;
    end if;
  else
    delete from public.post_likes
    where post_id = p_post_id and user_id = p_user_id;

    did_change := found;
    if did_change then
      update public.posts
      set like_count = greatest(0, like_count - 1)
      where id = p_post_id;
    end if;
  end if;

  return did_change;
end;
$$;

create or replace function public.toggle_post_save(
  p_post_id uuid,
  p_user_id uuid,
  p_save boolean
)
returns boolean
language plpgsql
as $$
declare
  did_change boolean := false;
begin
  if p_save then
    insert into public.post_saves (post_id, user_id)
    values (p_post_id, p_user_id)
    on conflict do nothing;

    did_change := found;
    if did_change then
      update public.posts
      set bookmark_count = bookmark_count + 1
      where id = p_post_id;
    end if;
  else
    delete from public.post_saves
    where post_id = p_post_id and user_id = p_user_id;

    did_change := found;
    if did_change then
      update public.posts
      set bookmark_count = greatest(0, bookmark_count - 1)
      where id = p_post_id;
    end if;
  end if;

  return did_change;
end;
$$;

create or replace function public.increment_post_share(p_post_id uuid)
returns integer
language plpgsql
as $$
declare
  next_share_count integer;
begin
  update public.posts
  set share_count = share_count + 1
  where id = p_post_id
  returning share_count into next_share_count;

  if next_share_count is null then
    raise exception 'post_not_found';
  end if;

  return next_share_count;
end;
$$;

create or replace function public.create_post_comment(
  p_post_id uuid,
  p_author_id uuid,
  p_body text
)
returns table (
  id uuid,
  post_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author jsonb
)
language plpgsql
as $$
declare
  inserted_comment public.comments%rowtype;
  author_profile public.profiles%rowtype;
begin
  insert into public.comments (post_id, author_id, body)
  values (p_post_id, p_author_id, p_body)
  returning * into inserted_comment;

  update public.posts
  set comment_count = comment_count + 1
  where public.posts.id = p_post_id;

  select * into author_profile
  from public.profiles
  where public.profiles.id = p_author_id;

  if author_profile.id is null then
    raise exception 'author_not_found';
  end if;

  return query
  select
    inserted_comment.id,
    inserted_comment.post_id,
    inserted_comment.author_id,
    inserted_comment.body,
    inserted_comment.created_at,
    jsonb_build_object(
      'id', author_profile.id,
      'username', author_profile.username,
      'display_name', author_profile.display_name,
      'avatar_url', author_profile.avatar_url
    );
end;
$$;

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;
alter table public.device_tokens enable row level security;
alter table public.video_uploads enable row level security;

create policy "profiles are readable"
on public.profiles for select
to authenticated
using (true);

create policy "profiles insert own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles update own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "posts readable"
on public.posts for select
to authenticated
using (true);

create policy "posts insert own"
on public.posts for insert
to authenticated
with check (auth.uid() = author_id);

create policy "posts update own"
on public.posts for update
to authenticated
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

create policy "comments readable"
on public.comments for select
to authenticated
using (true);

create policy "comments insert own"
on public.comments for insert
to authenticated
with check (auth.uid() = author_id);

create policy "comments update own"
on public.comments for update
to authenticated
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

create policy "comments delete own"
on public.comments for delete
to authenticated
using (auth.uid() = author_id);

create policy "likes readable"
on public.post_likes for select
to authenticated
using (true);

create policy "likes upsert own"
on public.post_likes for insert
to authenticated
with check (auth.uid() = user_id);

create policy "likes delete own"
on public.post_likes for delete
to authenticated
using (auth.uid() = user_id);

create policy "saves readable"
on public.post_saves for select
to authenticated
using (true);

create policy "saves upsert own"
on public.post_saves for insert
to authenticated
with check (auth.uid() = user_id);

create policy "saves delete own"
on public.post_saves for delete
to authenticated
using (auth.uid() = user_id);

create policy "device tokens own"
on public.device_tokens for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "video uploads own"
on public.video_uploads for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
