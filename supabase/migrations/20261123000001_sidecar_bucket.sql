-- Private bucket for images customers send in chat (slips, product photos, documents).
-- Staff see them through one-hour signed URLs issued by the `sidecar` edge function.
insert into storage.buckets (id, name, public)
values ('sidecar-media', 'sidecar-media', false)
on conflict (id) do nothing;
