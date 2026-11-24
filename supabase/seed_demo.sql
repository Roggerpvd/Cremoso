-- =====================================================================
--  RestoPOS · Datos de demostración (OPCIONAL)
--  Carta de ejemplo, 8 mesas y una promoción. Ejecutar DESPUÉS de la migración.
--  (Con Supabase CLI local: copiar a supabase/seed.sql y `supabase db reset`.)
-- =====================================================================
insert into public.tables (number, name, capacity)
select n, case when n > 6 then 'Terraza ' || (n - 6) end, case when n % 3 = 0 then 6 else 4 end
from generate_series(1, 8) n
on conflict (number) do nothing;

insert into public.categories (name, description, sort_order) values
  ('Entradas',   'Para empezar',                 1),
  ('Platos',     'Platos de fondo',              2),
  ('Hamburguesas','Con papas fritas',            3),
  ('Bebidas',    'Frías y calientes',            4),
  ('Postres',    'Dulces para cerrar',           5)
on conflict do nothing;

insert into public.products (category_id, name, description, ingredients, price, sort_order)
select c.id, v.name, v.descr, v.ingr, v.price, v.ord
from (values
  ('Entradas',     'Papas a la huancaína',  'Papa sancochada con crema de ají amarillo', 'Papa, ají amarillo, queso fresco, galleta', 14.00, 1),
  ('Entradas',     'Alitas BBQ (6 uds)',    'Alitas crocantes bañadas en salsa BBQ',      'Pollo, salsa BBQ, apio',                      22.00, 2),
  ('Platos',       'Lomo saltado',          'Clásico salteado al wok con papas fritas',   'Lomo fino, cebolla, tomate, ají amarillo, arroz', 32.00, 1),
  ('Platos',       'Pollo a la plancha',    'Pechuga con ensalada fresca y arroz',        'Pollo, lechuga, tomate, arroz',               26.00, 2),
  ('Hamburguesas', 'Clásica',               'Carne 150 g, queso, lechuga y tomate',       'Carne de res, queso cheddar, lechuga, tomate, pan brioche', 24.00, 1),
  ('Hamburguesas', 'Doble queso',           'Doble carne y doble queso',                  'Carne de res x2, queso cheddar x2, cebolla caramelizada',   32.00, 2),
  ('Bebidas',      'Gaseosa personal',      'Botella 500 ml',                             null,                                           5.00, 1),
  ('Bebidas',      'Chicha morada (jarra)', 'Jarra 1 litro',                              'Maíz morado, piña, canela, clavo',            14.00, 2),
  ('Bebidas',      'Limonada frozen',       'Vaso 450 ml',                                'Limón, hielo, azúcar',                         9.00, 3),
  ('Postres',      'Helado cremoso',        '2 bolas a elección',                         'Leche, crema, sabor a elección',               9.00, 1),
  ('Postres',      'Brownie con helado',    'Brownie tibio con bola de helado',           'Chocolate, nueces, helado de vainilla',       14.00, 2)
) as v(cat, name, descr, ingr, price, ord)
join public.categories c on lower(c.name) = lower(v.cat)
on conflict do nothing;

-- Ejemplo: 10 % en toda la categoría Bebidas (puedes desactivarla en Carta → Promociones)
insert into public.promotions (name, description, discount_type, discount_value, category_id)
select 'Bebidas -10%', 'Promoción de ejemplo', 'percent', 10, id
from public.categories where lower(name) = 'bebidas'
and not exists (select 1 from public.promotions where name = 'Bebidas -10%');
