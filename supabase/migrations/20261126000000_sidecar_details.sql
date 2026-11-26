-- Profile-specific lead fields (for example a property agency's role, intent, budget).
-- Which keys are allowed is decided by the deployment's profile, not by the database.
alter table sidecar.leads add column if not exists details jsonb not null default '{}'::jsonb;
