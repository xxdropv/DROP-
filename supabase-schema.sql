-- DROP VENDAS — schema completo no Supabase (Postgres)
-- Pode colar este arquivo inteiro no SQL Editor do Supabase e executar.
-- É seguro rodar de novo: usa "if not exists" / "on conflict do nothing" em tudo.

create table if not exists public.settings (
  id bigint primary key,
  name text not null default 'DROP VENDAS',
  whatsapp text not null,
  pix text not null,
  category_notes jsonb not null default '{}'::jsonb
);
alter table public.settings add column if not exists category_notes jsonb not null default '{}'::jsonb;

create table if not exists public.products (
  id bigint primary key,
  category text not null,
  name text not null,
  description text default '',
  badge text default '',
  variants jsonb not null default '[]'::jsonb,
  image_url text default '',
  active boolean not null default true,
  sort_order integer not null default 0
);
alter table public.products add column if not exists badge text default '';

-- Pedidos: criados quando o cliente clica em "Já paguei, continuar".
-- customer_whatsapp só é usado pelo painel administrativo, nunca aparece na loja.
-- status1/status2: status de entrega de cada ID (Aguardando entrega / Enviado / Entregue).
-- status: resumo geral do pedido, calculado a partir de status1+status2.
-- tracking_token: usado no link público /pedido/TOKEN pro cliente acompanhar sem precisar de login.
create table if not exists public.orders (
  id bigserial primary key,
  product_name text not null,
  price text not null,
  ff_id text not null,
  ff_id2 text default '',
  customer_whatsapp text default '',
  status text not null default 'Aguardando entrega',
  status1 text not null default 'Aguardando entrega',
  status2 text default '',
  tracking_token text unique,
  created_at timestamptz not null default now()
);
alter table public.orders add column if not exists status1 text not null default 'Aguardando entrega';
alter table public.orders add column if not exists status2 text default '';
alter table public.orders add column if not exists tracking_token text;
create unique index if not exists idx_orders_tracking_token on public.orders(tracking_token);

-- Usuário(s) do painel administrativo. A senha é sempre gravada em HASH
-- (nunca em texto puro) — o servidor cuida disso sozinho na primeira vez que roda,
-- usando ADMIN_USER / ADMIN_PASSWORD / MASTER_RECOVERY_CODE das variáveis de ambiente.
create table if not exists public.admin_users (
  id bigserial primary key,
  username text unique not null,
  password_hash text not null,
  recovery_code_hash text
);

alter table public.settings enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.admin_users enable row level security;
-- Nenhuma policy é criada de propósito: só o servidor (com a service_role key,
-- que ignora RLS) acessa essas tabelas. O navegador do cliente nunca fala direto com o Supabase.

insert into public.settings (id, name, whatsapp, pix, category_notes)
values (1, 'DROP VENDAS', 'https://wa.me/message/32WRFUDUVH3AB1', 'd5c81792-5b45-4703-914d-2bd55ffed79e',
  '{"CONJUNTOS": "Entrega via ID."}'::jsonb)
on conflict (id) do nothing;

insert into public.products (id,category,name,description,badge,variants,image_url,active,sort_order) values
(1,'DIAMANTES','942 Diamantes','','','[{"label": "", "price": "R$ 36,00", "dualId": false}]','',true,1),
(2,'DIAMANTES','1.248 Diamantes','','','[{"label": "", "price": "R$ 44,00", "dualId": false}]','',true,2),
(3,'DIAMANTES','1.896 Diamantes','','','[{"label": "", "price": "R$ 68,00", "dualId": false}]','',true,3),
(4,'DIAMANTES','2.442 Diamantes','','','[{"label": "", "price": "R$ 88,00", "dualId": false}]','',true,4),
(5,'DIAMANTES','2.652 Diamantes','','','[{"label": "", "price": "R$ 95,00", "dualId": false}]','',true,5),
(6,'DIAMANTES','3.318 Diamantes','','','[{"label": "", "price": "R$ 116,00", "dualId": false}]','',true,6),
(7,'DIAMANTES','3.768 Diamantes','','','[{"label": "", "price": "R$ 134,00", "dualId": false}]','',true,7),
(8,'DIAMANTES','4.182 Diamantes','','','[{"label": "", "price": "R$ 145,00", "dualId": false}]','',true,8),
(9,'DIAMANTES','5.310 Diamantes','','','[{"label": "", "price": "R$ 190,00", "dualId": false}]','',true,9),
(10,'DIAMANTES','6.930 Diamantes','','','[{"label": "", "price": "R$ 240,00", "dualId": false}]','',true,10),
(11,'DIAMANTES','7.554 Diamantes','','','[{"label": "", "price": "R$ 270,00", "dualId": false}]','',true,11),
(12,'PASSES','Passe Booyah de Setembro','Disponível agora.','','[{"label": "1 Passe", "price": "R$ 6,00", "dualId": false}, {"label": "2 Passes", "price": "R$ 10,00", "dualId": true}]','',true,12),
(13,'PASSES','Reserva Passe Booyah de Outubro','Reserva antecipada.','','[{"label": "1 Passe", "price": "R$ 5,50", "dualId": false}, {"label": "2 Passes", "price": "R$ 10,00", "dualId": true}]','',true,13),
(14,'CONJUNTOS','Ninja Preto','','','[{"label": "", "price": "R$ 24,00", "dualId": false}]','',true,14),
(15,'CONJUNTOS','Ninja Branco','','','[{"label": "", "price": "R$ 24,00", "dualId": false}]','',true,15),
(16,'CONJUNTOS','Combo Ninja','Um item por conta.','Combo','[{"label": "", "price": "R$ 45,00", "dualId": true}]','',true,16),
(17,'CONJUNTOS','Anjinha','','','[{"label": "", "price": "R$ 23,00", "dualId": false}]','',true,17),
(18,'CONJUNTOS','Diabinha','','','[{"label": "", "price": "R$ 23,00", "dualId": false}]','',true,18),
(19,'CONJUNTOS','Combo Anjinha + Diabinha','Um item por conta.','Combo','[{"label": "", "price": "R$ 43,00", "dualId": true}]','',true,19),
(20,'CONJUNTOS','Astronauta','','','[{"label": "", "price": "R$ 20,00", "dualId": false}]','',true,20),
(21,'CONJUNTOS','Spacefarer','','','[{"label": "", "price": "R$ 20,00", "dualId": false}]','',true,21),
(22,'CONJUNTOS','Combo Astronauta + Spacefarer','Um item por conta.','Combo','[{"label": "", "price": "R$ 40,00", "dualId": true}]','',true,22),
(23,'CONJUNTOS','Velho Rabugento','','','[{"label": "", "price": "R$ 20,00", "dualId": false}]','',true,23),
(24,'CODIGUIN','Codiguin FF','Código de recompensa aplicado direto na sua conta.','','[{"label": "", "price": "R$ 12,00", "dualId": false}]','',true,24)
on conflict (id) do nothing;

-- No painel do Supabase, crie um Storage bucket público chamado: product-images
