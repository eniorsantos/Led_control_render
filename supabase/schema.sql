-- Esquema para Supabase (PostgreSQL)
-- Espelha o modelo relacional de backend/src/db.js (spec §2 + §9)
--
-- COMO USAR:
-- 1. Crie um projeto no Supabase
-- 2. Vá ao SQL Editor e execute este script
-- 3. Obtenha a connection string (DATABASE_URL) em Settings > Database
-- 4. Defina DATABASE_URL como variável de ambiente no back-end (Render)
-- 5. O back-end detectará DATABASE_URL e usará PostgreSQL automaticamente

-- Tabela de configurações globais
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  n_inicio_proximo INTEGER NOT NULL DEFAULT 7,
  n_vencimento_proximo INTEGER NOT NULL DEFAULT 5,
  max_clientes_por_led INTEGER NOT NULL DEFAULT 8,
  logo_dataurl TEXT NOT NULL DEFAULT ''
);

-- Cidades onde existem painéis LED
CREATE TABLE IF NOT EXISTS cidades (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  uf TEXT NOT NULL DEFAULT '',
  fuso TEXT NOT NULL DEFAULT 'America/Maceio'
);

-- Painéis de LED físicos
CREATE TABLE IF NOT EXISTS leds (
  codigo TEXT PRIMARY KEY,
  endereco TEXT NOT NULL,
  cidade_id TEXT NOT NULL REFERENCES cidades(id),
  espacos_total INTEGER
);

-- Catálogo de anunciantes/clientes
CREATE TABLE IF NOT EXISTS anunciantes (
  nome TEXT PRIMARY KEY
);

-- Campanhas de veiculação
CREATE TABLE IF NOT EXISTS campanhas (
  id TEXT PRIMARY KEY,
  cidade_id TEXT NOT NULL REFERENCES cidades(id),
  led_codigo TEXT NOT NULL REFERENCES leds(codigo),
  anunciante TEXT NOT NULL REFERENCES anunciantes(nome),
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  reservada INTEGER NOT NULL DEFAULT 0
);

-- Programação de grade (spots horários)
CREATE TABLE IF NOT EXISTS programacoes (
  id TEXT PRIMARY KEY,
  campanha_id TEXT NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  led_codigo TEXT NOT NULL,
  horario_inicio TEXT NOT NULL,
  duracao_segundos INTEGER NOT NULL DEFAULT 15,
  dias_semana TEXT NOT NULL DEFAULT 'SEG',
  insercoes_dia INTEGER NOT NULL DEFAULT 1,
  autorizado_por TEXT,
  motivo_autorizacao TEXT
);

-- Usuários do sistema
CREATE TABLE IF NOT EXISTS usuarios (
  login TEXT PRIMARY KEY,
  senha TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'visualizador',
  nome TEXT NOT NULL DEFAULT ''
);

-- Vínculo usuário ↔ cidades visíveis
CREATE TABLE IF NOT EXISTS usuario_cidade (
  login TEXT NOT NULL REFERENCES usuarios(login) ON DELETE CASCADE,
  cidade_id TEXT NOT NULL REFERENCES cidades(id) ON DELETE CASCADE,
  PRIMARY KEY (login, cidade_id)
);

-- Recursos extras concedidos por usuário
CREATE TABLE IF NOT EXISTS permissoes (
  login TEXT NOT NULL REFERENCES usuarios(login) ON DELETE CASCADE,
  recurso TEXT NOT NULL,
  PRIMARY KEY (login, recurso)
);

-- Paleta de cores configurável (tema)
CREATE TABLE IF NOT EXISTS tema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  vars TEXT NOT NULL DEFAULT '{}'
);

-- Múltiplas reservas por campanha
CREATE TABLE IF NOT EXISTS reservas (
  id TEXT PRIMARY KEY,
  campanha_id TEXT NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  anunciante TEXT NOT NULL DEFAULT '',
  criada_por TEXT NOT NULL DEFAULT '',
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notificações/toasts de início próximo e vencimento
CREATE TABLE IF NOT EXISTS notificacoes (
  id SERIAL PRIMARY KEY,
  campanha_id TEXT NOT NULL,
  evento TEXT NOT NULL,
  titulo TEXT NOT NULL,
  corpo TEXT NOT NULL,
  dia TEXT NOT NULL,
  lida INTEGER NOT NULL DEFAULT 0,
  cidade_id TEXT NOT NULL DEFAULT '',
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campanha_id, evento, dia)
);

-- Log de operações de auditoria
CREATE TABLE IF NOT EXISTS auditoria (
  id SERIAL PRIMARY KEY,
  quando TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
  quem TEXT NOT NULL DEFAULT 'anon',
  oque TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT ''
);

-- Índices úteis para consultas do dashboard
CREATE INDEX IF NOT EXISTS idx_campanhas_led ON campanhas(led_codigo);
CREATE INDEX IF NOT EXISTS idx_campanhas_cidade ON campanhas(cidade_id);
CREATE INDEX IF NOT EXISTS idx_programacoes_led ON programacoes(led_codigo);
CREATE INDEX IF NOT EXISTS idx_reservas_campanha ON reservas(campanha_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_dia ON notificacoes(dia);

-- Refresh tokens (para rotação de JWT)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token TEXT PRIMARY KEY,
  login TEXT NOT NULL REFERENCES usuarios(login) ON DELETE CASCADE,
  expira_em TIMESTAMP NOT NULL,
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_login ON refresh_tokens(login);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expira ON refresh_tokens(expira_em);

-- Row Level Security (opcional — habilitar para controle granular pelo Supabase Auth)
-- Nota: se habilitar RLS, crie políticas apropriadas para cada tabela
-- alter table campanhas enable row level security;
-- alter table leds enable row level security;
-- alter table anunciantes enable row level security;
-- alter table reservas enable row level security;
-- alter table programacoes enable row level security;
-- alter table notificacoes enable row level security;
-- alter table auditoria enable row level security;
-- alter table usuarios enable row level security;
-- alter table usuario_cidade enable row level security;
-- alter table permissoes enable row level security;
-- alter table tema enable row level security;
-- alter table config enable row level security;

-- ============================================================
-- SEED DE DADOS INICIAIS (execute após criar as tabelas)
-- ============================================================

-- 1. Config (sempre id=1)
INSERT INTO config (id, n_inicio_proximo, n_vencimento_proximo, max_clientes_por_led, logo_dataurl)
VALUES (1, 7, 5, 8, '')
ON CONFLICT (id) DO NOTHING;

-- 2. Cidades
INSERT INTO cidades (id, nome, uf, fuso) VALUES
  ('aracaju', 'Aracaju', 'SE', 'America/Maceio'),
  ('salvador', 'Salvador', 'BA', 'America/Bahia')
ON CONFLICT (id) DO NOTHING;

-- 3. LEDs
INSERT INTO leds (codigo, endereco, cidade_id, espacos_total) VALUES
  ('AJU 01', 'Silvio Teixeira', 'aracaju', 8),
  ('AJU 02', 'Tancredo Neves', 'aracaju', 8),
  ('AJU 03', 'Adélia Franco', 'aracaju', 8),
  ('AJU 04', 'Francisco Porto', 'aracaju', 8)
ON CONFLICT (codigo) DO NOTHING;

-- 4. Anunciantes
INSERT INTO anunciantes (nome) VALUES
  ('Atakarejo'),
  ('Vita'),
  ('Diniz Fonseca'),
  ('Jardins Delicatessen'),
  ('Boticário'),
  ('Hospital dos Olhos'),
  ('Rede Primavera'),
  ('São Braz')
ON CONFLICT (nome) DO NOTHING;

-- 5. Campanhas
INSERT INTO campanhas (id, cidade_id, led_codigo, anunciante, inicio, fim, reservada) VALUES
  ('c1', 'aracaju', 'AJU 01', 'Atakarejo', '2026-02-10', '2027-04-09', 0),
  ('c2', 'aracaju', 'AJU 01', 'Boticário', '2026-11-14', '2026-11-28', 1),
  ('c3', 'aracaju', 'AJU 02', 'Vita', '2026-08-01', '2026-12-20', 0),
  ('c4', 'aracaju', 'AJU 02', 'Diniz Fonseca', '2026-06-15', '2026-09-30', 0),
  ('c5', 'aracaju', 'AJU 03', 'Jardins Delicatessen', '2026-09-01', '2027-01-31', 0),
  ('c6', 'aracaju', 'AJU 03', 'Hospital dos Olhos', '2026-10-20', '2026-10-31', 0),
  ('c7', 'aracaju', 'AJU 04', 'São Braz', '2026-07-10', '2026-12-10', 0),
  ('c8', 'aracaju', 'AJU 04', 'Rede Primavera', '2026-10-27', '2026-11-14', 1)
ON CONFLICT (id) DO NOTHING;

-- 6. Programações
INSERT INTO programacoes (id, campanha_id, led_codigo, horario_inicio, duracao_segundos, dias_semana, insercoes_dia) VALUES
  ('s1', 'c1', 'AJU 01', '07:00', 15, 'SEG', 1),
  ('s2', 'c3', 'AJU 01', '07:15', 15, 'SEG', 1),
  ('s3', 'c4', 'AJU 01', '07:30', 10, 'SEG', 1)
ON CONFLICT (id) DO NOTHING;

-- 7. Usuários (hashes bcrypt corretos para as senhas padrão)
-- admin123    -> $2b$10$wWPN/swbXIATGeHuTYmQjuGke4NwASj0S4yL0UXAQ76873/3GWpeO
-- reg123      -> $2b$10$dci/7GSe5bpLp767G1ybJ.H.ssEfePtv4iDIFLYTI3f7FHXVvBKx.
-- op123       -> $2b$10$XCHo.MrUx60JwGrowEFnpuu4LrC9w6.HSMQZ31Dv16vPs0jdfELIe
-- view123     -> $2b$10$kRp1kkMjVPnaV1QxG.O0QeamFspXXKfSXbaDvZf50oX28jk81L1vq
INSERT INTO usuarios (login, senha, perfil, nome) VALUES
  ('admin',    '$2b$10$wWPN/swbXIATGeHuTYmQjuGke4NwASj0S4yL0UXAQ76873/3GWpeO', 'admin',         'Administrador'),
  ('regional', '$2b$10$dci/7GSe5bpLp767G1ybJ.H.ssEfePtv4iDIFLYTI3f7FHXVvBKx.', 'regional',      'Gestor Regional'),
  ('operador', '$2b$10$XCHo.MrUx60JwGrowEFnpuu4LrC9w6.HSMQZ31Dv16vPs0jdfELIe', 'operador',      'Operador'),
  ('viewer',   '$2b$10$kRp1kkMjVPnaV1QxG.O0QeamFspXXKfSXbaDvZf50oX28jk81L1vq', 'visualizador', 'Visualizador')
ON CONFLICT (login) DO UPDATE SET
  senha = EXCLUDED.senha,
  perfil = EXCLUDED.perfil,
  nome = EXCLUDED.nome;

-- 8. Usuário ↔ Cidades (regional só vê Aracaju)
INSERT INTO usuario_cidade (login, cidade_id) VALUES
  ('regional', 'aracaju')
ON CONFLICT (login, cidade_id) DO NOTHING;

-- 9. Reserva exemplo (Jardins - campanha c5)
INSERT INTO reservas (id, campanha_id, inicio, fim, anunciante, criada_por, criada_em) VALUES
  ('r1', 'c5', '2027-02-01', '2027-02-28', 'Jardins Delicatessen', 'admin', NOW())
ON CONFLICT (id) DO NOTHING;

-- 10. Tema vazio
INSERT INTO tema (id, vars) VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;
