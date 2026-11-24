-- Prepara 40 mesas y sube el límite de pendientes QR para la prueba de carga
\set ON_ERROR_STOP on
delete from public.payments; delete from public.order_items; delete from public.orders;
insert into public.tables (number) select 100 + n from generate_series(1, 40) n on conflict do nothing;
update public.restaurant_settings set qr_max_pending_per_table = 20, qr_ordering_enabled = true, prices_include_tax = true;
create table if not exists public.race_ctl (k text primary key, v text);
insert into public.race_ctl values ('token', (select qr_token from public.tables where number = 101)) on conflict (k) do update set v = excluded.v;
