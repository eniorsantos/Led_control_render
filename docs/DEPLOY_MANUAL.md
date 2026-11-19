# Manual Completo de Deploy — SaaS Controle de Veiculação LED

> **Stack:** Frontend (Vercel) + Backend (Render) + Database (Supabase/PostgreSQL)
> **Repositório:** https://github.com/eniorsantos/Led_control_render.git

---

## Índice

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Passo 1: Supabase — Banco de Dados PostgreSQL](#3-passo-1-supabase--banco-de-dados-postgresql)
4. [Passo 2: Render — Backend API](#4-passo-2-render--backend-api)
5. [Passo 3: Vercel — Frontend React](#5-passo-3-vercel--frontend-react)
6. [Passo 4: Verificação End-to-End](#6-passo-4-verificação-end-to-end)
7. [Variáveis de Ambiente — Resumo](#7-variáveis-de-ambiente--resumo)
8. [Troubleshooting Comum](#8-troubleshooting-comum)
9. [Rollback e Atualizações](#9-rollback-e-atualizações)
10. [Checklist de Produção](#10-checklist-de-produção)

---

## 1. Visão Geral da Arquitetura

```
┌─────────────────┐     HTTPS      ┌─────────────────┐     TCP/SSL     ┌─────────────────┐
│   USUÁRIO       │ ◄─────────────► │   VERCEL        │ ◄─────────────► │   RENDER        │
│   (Navegador)   │                 │   (Frontend)    │   API Calls     │   (Backend)     │
│                 │                 │   React + Vite  │                 │   Node/Express  │
└─────────────────┘                 └─────────────────┘                 └────────┬────────┘
                                                                                  │
                                                                                  │ SQL/SSL
                                                                                  ▼
                                                                        ┌─────────────────┐
                                                                        │   SUPABASE      │
                                                                        │   PostgreSQL    │
                                                                        │   (Database)    │
                                                                        └─────────────────┘
```

**Fluxo de dados:**
1. Usuário acessa `https://seu-app.vercel.app`
2. Frontend (React) carrega, faz login via `/api/auth/login`
3. Backend (Render) valida credenciais, retorna JWT
4. Frontend usa JWT em headers `Authorization: Bearer <token>`
5. Backend consulta/escreve no Supabase (PostgreSQL)
6. Dados retornam ao frontend para exibição

---

## 2. Pré-requisitos

| Item | Versão Mínima | Verificação |
|------|---------------|-------------|
| Git | 2.30+ | `git --version` |
| Node.js | 20+ (LTS) | `node --version` |
| npm | 10+ | `npm --version` |
| Conta GitHub | — | github.com |
| Conta Vercel | — | vercel.com |
| Conta Render | — | render.com |
| Conta Supabase | — | supabase.com |

**Contas recomendadas:** Use o mesmo e-mail (ex: GitHub) para todas as plataformas — facilita integração OAuth.

---

## 3. Passo 1: Supabase — Banco de Dados PostgreSQL

### 3.1 Criar Projeto

1. Acesse [supabase.com](https://supabase.com) → **Sign in** → **New project**
2. **Organization:** Selecione ou crie uma
3. **Project name:** `saas-leds-db` (ou nome de sua preferência)
4. **Database Password:** Gere uma senha forte (salve no gerenciador de senhas!)
   - ⚠️ **Esta senha NÃO pode ser recuperada depois** — anote em local seguro
5. **Region:** Escolha a mais próxima dos usuários (ex: `South America (São Paulo)` para Brasil)
6. **Pricing Plan:** Free tier (suficiente para começar)
7. Clique **Create new project** → Aguarde ~2 minutos

### 3.2 Executar Schema SQL

1. No dashboard do projeto → **SQL Editor** (ícone `</>` na barra lateral)
2. Clique **New query**
3. Copie **TODO** o conteúdo de `supabase/schema.sql` do repositório
4. Cole no editor → **Run** (Ctrl+Enter)
5. Verifique: deve aparecer `Success. No rows returned` para cada statement
6. Confirme tabelas criadas: **Table Editor** → deve listar:
   - `config`, `cidades`, `leds`, `anunciantes`, `campanhas`, `programacoes`
   - `usuarios`, `usuario_cidade`, `permissoes`, `tema`, `reservas`
   - `notificacoes`, `auditoria`, `refresh_tokens`

### 3.3 Obter Connection String

1. **Settings** (ícone ⚙️) → **Database**
2. Role até **Connection string** → Selecione **URI** (não Pooler para Render)
3. Copie a string (formato: `postgresql://postgres:[SENHA]@db.[REF].supabase.co:5432/postgres`)
4. **Substitua `[SENHA]`** pela senha que você definiu no passo 3.1
5. **Salve esta string** — é o `DATABASE_URL` para o Render

> **Dica:** Use o **Pooler (Transaction mode)** apenas se tiver muitos connections simultâneos. Para este app, URI direta funciona bem.

### 3.4 Configurar RLS (Row Level Security) — Opcional

O schema já define PKs e FKs. Se quiser segurança extra:

```sql
-- Habilitar RLS nas tabelas sensíveis
ALTER TABLE campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE leds ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

-- Políticas básicas (ajuste conforme necessidade)
CREATE POLICY "Authenticated users can read" ON campanhas
  FOR SELECT USING (auth.role() = 'authenticated');
```

---

## 4. Passo 2: Render — Backend API

### 4.1 Conectar Repositório

1. Acesse [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
2. **Build and deploy from a Git repository** → **Connect** GitHub
3. Autorize Render a acessar seus repositórios (ou apenas `eniorsantos/Led_control_render`)
4. Selecione o repo → **Connect**

### 4.2 Configurar Build & Deploy

| Campo | Valor |
|-------|-------|
| **Name** | `saas-leds-api` (ou seu nome) |
| **Region** | Same as Supabase (ex: `South America (São Paulo)`) |
| **Branch** | `master` (ou `main`) |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Auto-Deploy** | `Yes` |

### 4.3 Variáveis de Ambiente (Environment Variables)

Clique **Add Environment Variable** para cada uma:

| Key | Value | Secret? | Descrição |
|-----|-------|---------|-----------|
| `DATABASE_URL` | `postgresql://postgres:SUA_SENHA@db.xxx.supabase.co:5432/postgres` | **YES** | Connection string do Supabase (passo 3.3) |
| `JWT_SECRET` | *(gere um valor forte)* | **YES** | Segredo JWT — Render pode gerar: clique **Generate Value** |
| `SEED` | `false` | NO | Produção nasce vazia |
| `HOJE` | *(vazio)* | NO | Data real do servidor |
| `PORT` | `3001` | NO | Porta interna (Render expõe na 443/80) |
| `NODE_ENV` | `production` | NO | Habilita SSL no pg driver |

> ⚠️ **NÃO marque como Secret:** `SEED`, `HOJE`, `PORT`, `NODE_ENV`
> ✅ **MARQUE como Secret:** `DATABASE_URL`, `JWT_SECRET`

### 4.4 Health Check

- **Health Check Path:** `/api/health`
- Render fará GET periódicas — retorna `{ "ok": true, "hoje": "..." }`

### 4.5 Deploy Inicial

1. Clique **Create Web Service**
2. Aguarde build (~3-5 min):
   - `npm install` → instala dependências
   - `npm start` → sobe servidor Express
   - Health check passa → **Live**
3. Anote a **URL pública**: `https://saas-leds-api.onrender.com` (ou seu nome)

### 4.6 Verificar Backend

```bash
# Health check
curl https://saas-leds-api.onrender.com/api/health
# {"ok":true,"hoje":"2026-11-19"}

# Login (teste)
curl -X POST https://saas-leds-api.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","senha":"admin123"}'
# {"token":"eyJhbGciOi...", "user":{...}}
```

> **Nota:** O primeiro login `admin/admin123` **só funciona se o seed rodou**. Em produção `SEED=false`, então crie o admin via SQL ou use o endpoint de criação de usuário (requer auth).

---

## 5. Passo 3: Vercel — Frontend React

### 5.1 Conectar Repositório

1. Acesse [vercel.com](https://vercel.com) → **Add New...** → **Project**
2. **Import Git Repository** → Selecione `eniorsantos/Led_control_render`
3. **Root Directory:** `frontend`
4. Framework Preset: **Vite** (detecta automaticamente)

### 5.2 Configurar Build

| Campo | Valor |
|-------|-------|
| **Project Name** | `saas-leds-frontend` |
| **Framework Preset** | `Vite` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` |
| **Development Command** | `npm run dev` |

### 5.3 Variáveis de Ambiente

Clique **Environment Variables** → **Add**:

| Name | Value | Environment |
|------|-------|-------------|
| `VITE_API_URL` | `https://saas-leds-api.onrender.com` | Production, Preview, Development |

> **Importante:** Use a URL **exata** do Render (com `https://`, sem barra final)

### 5.4 Deploy

1. Clique **Deploy**
2. Aguarde (~2-3 min):
   - `npm install`
   - `npm run build` → TypeScript check + Vite build
   - Deploy estático → CDN global
3. Anote a **URL**: `https://saas-leds-frontend.vercel.app` (ou seu nome)

### 5.5 Configurar Domínio Próprio (Opcional)

1. No projeto Vercel → **Settings** → **Domains**
2. **Add** → digite seu domínio (ex: `leds.seudominio.com`)
3. Configure DNS:
   - **A record** → `76.76.21.21` (Vercel)
   - **CNAME** → `cname.vercel-dns.com` (para www)
4. Vercel provisiona SSL automático (Let's Encrypt)

---

## 6. Passo 4: Verificação End-to-End

### 6.1 Checklist de Funcionamento

| Teste | Comando/ação | Esperado |
|-------|--------------|----------|
| Frontend carrega | Abrir `https://seu-app.vercel.app` | Tela de login |
| Health check | `curl https://api.onrender.com/api/health` | `{"ok":true}` |
| Login admin | UI ou curl POST `/api/auth/login` | JWT token retornado |
| Dashboard | Login → `/dashboard` | KPIs, gráficos, Gantt |
| Planilha | Menu → Planilha | ≥ 8 campanhas (se seed) |
| CORS | Console browser → Network | Sem erros CORS |
| WebSocket/Realtime | N/A (não usa) | — |

### 6.2 Teste de Criação de Dados (Produção)

Como `SEED=false`, banco nasce vazio. Crie dados:

```bash
# 1. Login
TOKEN=$(curl -s -X POST https://api.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","senha":"admin123"}' | jq -r .token)

# 2. Criar cidade
curl -X POST https://api.onrender.com/api/cidades \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"sp","nome":"São Paulo","uf":"SP"}'

# 3. Criar LED
curl -X POST https://api.onrender.com/api/leds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"SP 01","endereco":"Av. Paulista","cidade_id":"sp"}'

# 4. Criar anunciante + campanha
curl -X POST https://api.onrender.com/api/campanhas \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"c1","cidade_id":"sp","led_codigo":"SP 01","anunciante":"Teste","inicio":"2026-12-01","fim":"2027-01-31"}'
```

### 6.3 Verificar no Supabase

1. **Table Editor** → `cidades`, `leds`, `campanhas` → dados aparecem
2. **Logs** → **Database** → queries executadas

---

## 7. Variáveis de Ambiente — Resumo

### Backend (Render)

```env
# OBRIGATÓRIAS (Secret)
DATABASE_URL=postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres
JWT_SECRET=valor-forte-gerado-pelo-render-ou-sua-chave-64-chars

# OPCIONAIS
SEED=false
HOJE=
PORT=3001
NODE_ENV=production
```

### Frontend (Vercel)

```env
VITE_API_URL=https://saas-leds-api.onrender.com
```

### Desenvolvimento Local (`.env` no `backend/`)

```env
# Para rodar local com SQLite
SEED=true
HOJE=2026-10-25
JWT_SECRET=led-control-dev-mude-em-producao
PORT=3001

# Para rodar local com Supabase (descomente):
# DATABASE_URL=postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres
```

---

## 8. Troubleshooting Comum

### 8.1 Backend: "relation does not exist" / Erro de Schema

**Sintoma:** Logs mostram `error: relation "campanhas" does not exist`

**Causa:** Schema não executou no Supabase

**Solução:**
1. Supabase → SQL Editor → Execute `supabase/schema.sql` novamente
2. Verifique se tabelas aparecem no **Table Editor**

### 8.2 Backend: "ECONNREFUSED" / "ETIMEDOUT" ao conectar no Supabase

**Sintoma:** `connect ECONNREFUSED` ou timeout

**Causas:**
- `DATABASE_URL` incorreta (senha errada, host errado)
- Render não consegue acessar IP do Supabase (raro)
- Supabase paused (free tier pausa após 1 semana inativo)

**Solução:**
1. Verifique `DATABASE_URL` no Render → **Environment** → clique no olho para ver valor
2. Supabase → Settings → Database → **Connection pooling** → Use **Session Pooler** se persistir
3. Acesse Supabase dashboard → "Resume project" se pausado

### 8.3 Frontend: Erro CORS

**Sintoma:** Console: `blocked by CORS policy`

**Causa:** Backend não permite origin do Vercel

**Solução:**
- Backend (`index.js`) já tem `app.use(cors())` — permite todas as origins
- Se customizou, adicione: `origin: ['https://seu-app.vercel.app', 'http://localhost:5173']`

### 8.4 Frontend: "Failed to fetch" / Network Error

**Sintoma:** Login falha, Network mostra erro

**Causas:**
- `VITE_API_URL` incorreta (sem `https://`, com barra final, typo)
- Backend down (Render free tier dorme após 15 min inativo)

**Solução:**
1. Verifique `VITE_API_URL` no Vercel → Settings → Environment Variables
2. Render free tier: primeiro request acorda o serviço (~30s delay)
3. Teste direto: `curl https://api.onrender.com/api/health`

### 8.5 Login: "credenciais inválidas" em produção

**Sintoma:** Admin não consegue logar

**Causa:** `SEED=false` → banco vazio → admin não existe

**Solução:**
```sql
-- No Supabase SQL Editor, execute:
INSERT INTO usuarios (login, senha, perfil, nome)
VALUES ('admin', crypt('admin123', gen_salt('bf')), 'admin', 'Administrador');
-- OU use bcrypt hash: '$2b$10$...' (gere com bcrypt.hashSync('admin123', 10))
```
> O app usa comparação direta (não bcrypt verify em produção atual). Para bcrypt real, altere `index.js` login para usar `bcrypt.compare()`.

### 8.6 Build falha no Render/Vercel

**Render:** `npm install` falha
- Verifique `package.json` — `better-sqlite3` precisa de build nativo
- Render tem Python/gcc? Adicione `BUILD_COMMAND: npm install --ignore-scripts && npm rebuild better-sqlite3`

**Vercel:** `tsc --noEmit` falha
- Verifique erros TypeScript no log
- Comum: tipos de `api.ts` desatualizados vs backend

---

## 9. Rollback e Atualizações

### 9.1 Rollback no Render

1. Dashboard → **saas-leds-api** → **Deploys**
2. Clique no deploy anterior → **Rollback to this deploy**
3. Confirma → novo deploy inicia automaticamente

### 9.2 Rollback no Vercel

1. Dashboard → **saas-leds-frontend** → **Deployments**
2. Clique `...` no deploy anterior → **Promote to Production**

### 9.3 Atualizações de Schema (Migrações)

**Supabase não tem migrações automáticas.** Para alterar tabelas:

```sql
-- Exemplo: adicionar coluna
ALTER TABLE campanhas ADD COLUMN nova_coluna TEXT DEFAULT '';

-- No código (db.unified.js), a função getTableColumns detecta automaticamente
-- Mas para NOT NULL columns, faça em 2 passos:
ALTER TABLE campanhas ADD COLUMN nova_coluna TEXT;
UPDATE campanhas SET nova_coluna = 'valor_padrao';
ALTER TABLE campanhas ALTER COLUMN nova_coluna SET NOT NULL;
```

**Fluxo recomendado:**
1. Teste migração local (`SEED=true` + SQL manual)
2. Commit + push → Render deploya backend
3. Execute SQL no Supabase (manual ou via script CI/CD)
4. Vercel deploya frontend (se API mudou)

---

## 10. Checklist de Produção

### Antes do Deploy

- [ ] Schema `supabase/schema.sql` testado localmente
- [ ] Smoke test passa: `HOJE=2026-10-25 SEED=true npm test`
- [ ] `JWT_SECRET` forte gerado (64+ chars aleatórios)
- [ ] `DATABASE_URL` com senha correta do Supabase
- [ ] `VITE_API_URL` aponta para URL final do Render
- [ ] Domínios configurados (se usar domínio próprio)

### Pós-Deploy (Validação)

- [ ] `GET /api/health` → 200 OK
- [ ] Login `admin/admin123` funciona (ou admin criado via SQL)
- [ ] Dashboard carrega KPIs, gráficos, Gantt
- [ ] Planilha lista campanhas
- [ ] Criação/edição de campanhas funciona
- [ ] Upload de logo funciona
- [ ] Exportação CSV/XLSX baixa arquivo
- [ ] Backup/restore funciona
- [ ] Logout + login mantém sessão (JWT válido 12h)

### Monitoramento Contínuo

- [ ] **Render:** Alerts → CPU > 80%, Memory > 80%, Downtime
- [ ] **Supabase:** Database size, Connections, API requests
- [ ] **Vercel:** Function invocations, Bandwidth, Errors
- [ ] **Logs:** Configure log drain (Datadog, Logtail, ou Render logs)

---

## Apêndice: Comandos Úteis

```bash
# Testar backend localmente com Supabase
cd backend
DATABASE_URL="postgresql://..." SEED=false npm start

# Testar frontend localmente apontando para Render
cd frontend
VITE_API_URL=https://api.onrender.com npm run dev

# Ver logs Render (CLI)
render logs saas-leds-api --tail

# Ver logs Vercel (CLI)
vercel logs https://seu-app.vercel.app

# Backup Supabase (manual)
pg_dump "postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres" > backup.sql

# Restaurar backup
psql "postgresql://postgres:SENHA@db.xxx.supabase.co:5432/postgres" < backup.sql
```

---

## Suporte e Recursos

| Recurso | Link |
|---------|------|
| Documentação completa | `docs/11-documentacao-detalhada.md` |
| Refatoração Render+Supabase | `docs/refactor-render-supabase.md` |
| AGENTS.md (resumo técnico) | `AGENTS.md` |
| Issues GitHub | https://github.com/eniorsantos/Led_control_render/issues |
| Render Docs | https://render.com/docs |
| Vercel Docs | https://vercel.com/docs |
| Supabase Docs | https://supabase.com/docs |

---

**Última atualização:** 2026-11-19  
**Versão do projeto:** Conforme `package.json` (`saas-leds-backend@1.0.0`, `saas-leds-frontend@1.0.0`)