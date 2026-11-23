-- Sidecar Agent: lead card, notes, album and orders that sit next to LINE OA.
-- Everything lives in its own schema. The schema is not exposed through
-- PostgREST; only the `sidecar` edge function reaches it, over the database URL.
-- RLS is on with no policies, so anon/authenticated roles can never read it
-- even if the schema is exposed by mistake.

create schema if not exists sidecar;

create table if not exists sidecar.staff (
  id            integer generated always as identity primary key,
  name          text not null,
  role          text not null default 'agent' check (role in ('admin', 'agent')),
  token_hash    text not null unique,
  line_user_id  text unique,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists sidecar.leads (
  id                    integer generated always as identity primary key,
  oa_id                 text,
  line_user_id          text not null unique,
  chat_id               text,
  display_name          text,
  picture_url           text,
  full_name             text,
  phone                 text,
  address               text,
  postcode              text,
  stage                 text not null default 'new'
                        check (stage in ('new', 'interested', 'quoted', 'awaiting_payment',
                                         'paid', 'booked', 'won', 'lost', 'spam')),
  tags                  text[] not null default '{}',
  interests             text[] not null default '{}',
  assignee_id           integer references sidecar.staff (id) on delete set null,
  ai_summary            text,
  next_action           text,
  suggested_reply       text,
  follow_up_at          timestamptz,
  locked_fields         text[] not null default '{}',
  last_message_at       timestamptz,
  last_message_preview  text,
  processing_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists leads_activity_idx on sidecar.leads (last_message_at desc nulls last, id desc);
create index if not exists leads_stage_idx on sidecar.leads (stage);
create index if not exists leads_phone_idx on sidecar.leads (phone) where phone is not null;
create index if not exists leads_chat_id_idx on sidecar.leads (chat_id) where chat_id is not null;
create index if not exists leads_follow_up_idx on sidecar.leads (follow_up_at) where follow_up_at is not null;
create index if not exists leads_display_name_idx on sidecar.leads (lower(display_name));

create table if not exists sidecar.media (
  id            integer generated always as identity primary key,
  lead_id       integer not null references sidecar.leads (id) on delete cascade,
  storage_path  text not null,
  content_type  text,
  category      text not null default 'other'
                check (category in ('slip', 'product', 'before_after', 'document', 'other')),
  caption       text,
  slip          jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists media_lead_idx on sidecar.media (lead_id, id desc);

create table if not exists sidecar.messages (
  id               integer generated always as identity primary key,
  lead_id          integer not null references sidecar.leads (id) on delete cascade,
  line_message_id  text unique,
  direction        text not null default 'in' check (direction in ('in', 'out')),
  type             text not null default 'text' check (type in ('text', 'image', 'sticker', 'other')),
  text             text,
  media_id         integer references sidecar.media (id) on delete set null,
  analysed         boolean not null default false,
  sent_at          timestamptz not null default now()
);

create index if not exists messages_lead_idx on sidecar.messages (lead_id, id desc);

create table if not exists sidecar.webhook_events (
  webhook_event_id  text primary key,
  received_at       timestamptz not null default now()
);

create table if not exists sidecar.notes (
  id           integer generated always as identity primary key,
  lead_id      integer not null references sidecar.leads (id) on delete cascade,
  body         text not null,
  kind         text not null default 'staff' check (kind in ('ai', 'staff', 'system')),
  author_name  text,
  pinned       boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notes_lead_idx on sidecar.notes (lead_id, id desc);

create table if not exists sidecar.products (
  id          integer generated always as identity primary key,
  sku         text,
  name        text not null,
  price       numeric(12, 2) not null default 0,
  category    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists products_name_idx on sidecar.products (lower(name));

create table if not exists sidecar.orders (
  id              integer generated always as identity primary key,
  lead_id         integer not null references sidecar.leads (id) on delete cascade,
  status          text not null default 'draft'
                  check (status in ('draft', 'awaiting_payment', 'paid', 'cancelled')),
  discount        numeric(12, 2) not null default 0,
  shipping_fee    numeric(12, 2) not null default 0,
  payment_method  text check (payment_method in ('transfer', 'cod', 'installment')),
  deposit_amount  numeric(12, 2),
  note            text,
  staff_edited    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists orders_lead_idx on sidecar.orders (lead_id, id desc);

create table if not exists sidecar.order_items (
  id          integer generated always as identity primary key,
  order_id    integer not null references sidecar.orders (id) on delete cascade,
  product_id  integer references sidecar.products (id) on delete set null,
  name        text not null,
  qty         integer not null default 1 check (qty > 0),
  unit_price  numeric(12, 2) not null default 0
);

create index if not exists order_items_order_idx on sidecar.order_items (order_id, id);

create table if not exists sidecar.settings (
  key    text primary key,
  value  text not null default ''
);

insert into sidecar.settings (key, value) values
  ('shop_name', 'ร้านของเรา'),
  ('payment_instructions', 'โอนเงินตามบัญชีที่แอดมินแจ้ง แล้วส่งสลิปในแชทนี้ได้เลยค่ะ')
on conflict (key) do nothing;

alter table sidecar.staff          enable row level security;
alter table sidecar.leads          enable row level security;
alter table sidecar.media          enable row level security;
alter table sidecar.messages       enable row level security;
alter table sidecar.webhook_events enable row level security;
alter table sidecar.notes          enable row level security;
alter table sidecar.products       enable row level security;
alter table sidecar.orders         enable row level security;
alter table sidecar.order_items    enable row level security;
alter table sidecar.settings       enable row level security;
