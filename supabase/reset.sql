-- =====================================================================
--  RestoPOS · REINICIO TOTAL (solo desarrollo)
--  Borra TODAS las tablas, funciones y tipos del sistema. Los usuarios de
--  Supabase Auth NO se borran (se gestionan en Authentication → Users).
--  Después de ejecutarlo, vuelve a correr las migraciones 20260101000000_init_schema.sql y 20260102000000_receipts.sql
-- =====================================================================
drop trigger  if exists on_auth_user_created on auth.users;

drop view     if exists public.menu_products;
drop table    if exists public.receipts            cascade;
drop table    if exists public.payments            cascade;
drop table    if exists public.order_items         cascade;
drop table    if exists public.orders              cascade;
drop table    if exists public.promotions          cascade;
drop table    if exists public.products            cascade;
drop table    if exists public.categories          cascade;
drop table    if exists public.tables              cascade;
drop table    if exists public.restaurant_settings cascade;
drop table    if exists public.users               cascade;
drop table    if exists public.roles               cascade;

drop function if exists public.get_table_by_token(text);
drop function if exists public.create_qr_order(text, jsonb, uuid, text);
drop function if exists public.get_table_orders(text);
drop function if exists public.get_my_profile();
drop function if exists public.create_staff_order(uuid, jsonb, text, uuid);
drop function if exists public.replace_order_items(uuid, jsonb, text);
drop function if exists public.set_order_status(uuid, public.order_status);
drop function if exists public.cancel_order(uuid, text);
drop function if exists public.register_payment(uuid[], public.payment_method, text);
drop function if exists public.admin_update_user(uuid, smallint, text, boolean);
drop function if exists public.regenerate_table_token(uuid);
drop function if exists public.sales_report(date, date);

drop schema   if exists private cascade;

drop type     if exists public.order_status;
drop type     if exists public.order_channel;
drop type     if exists public.receipt_status;
drop type     if exists public.payment_status;
drop type     if exists public.payment_method;
drop type     if exists public.discount_type;

-- Storage: las imágenes subidas se conservan; bórralas desde el Dashboard si quieres.
