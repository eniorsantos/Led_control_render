# Refatoração para Deploy no Render + Supabase

## Resumo das Alterações

Esta refatoração migra o projeto de SQLite local (com disco persistente) para PostgreSQL/Supabase em produção, mantendo compatibilidade total com desenvolvimento local em SQLite.

---

## Arquivos Criados

### `backend/src/db.unified.js` — Camada Unificada de Acesso a Dados
**Nova camada que detecta automaticamente o ambiente:**

```javascript
const USING_POSTGRES = !!process.env.DATABASE_URL;
```

| Ambiente | Driver | Placeholders | Transações |
|----------|--------|--------------|------------|
| Local (sem `DATABASE_URL`) | `better-sqlite3` (síncrono) | `?` | `sqliteDb.transaction()` |
| Produção (com `DATABASE_URL`) | `pg` (assíncrono) | `$1, $2...` | `pool.connect()` + `BEGIN/COMMIT` |

**Funcionalidades:**
- API assíncrona uniforme: `prepare(sql).run()`, `.get()`, `.all()`, `.transaction()`
- Normalização automática de SQL:
  - `?` → `$1, $2...` (para pg)
  - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`
  - `INSERT OR REPLACE` → `INSERT ... ON CONFLICT (pk) DO UPDATE SET ...`
  - `PRAGMA table_info(t)` → `information_schema.columns` (para pg)
- Seed integrado (só executa em SQLite com `SEED=true`)
- Admin de resgate (cria `admin/admin123` se banco vazio)

---

## Arquivos Modificados

### `backend/src/index.js`
**Principais correções:**

| Problema | Solução |
|----------|---------|
| Import antigo | `require('./db.adapter')` → `require('./db.unified')` |
| `R.getConfig(db)` síncrono | `await R.getConfig(db)` (agora async) |
| `filtroEfetivo(req)` síncrono | `async function filtroEfetivo` + `await` nas chamadas |
| `comStatus(rows)` síncrono | `async function comStatus` + `await` nas chamadas |
| `escopoCidadeOk` sem await | `await escopoCidadeOk(...)` |
| Transação backup/restore | Usa `txPrepare` do callback da transaction |

**Linhas alteradas:** ~50 pontos de `await` adicionados para consistência assíncrona

### `backend/render.yaml`
```yaml
# ANTES (com disco persistente)
# disk:
#   name: data
#   mountPath: /data
#   sizeGB: 1

# DEPOIS (sem disco, DATABASE_URL obrigatório)
envVars:
  - key: DATABASE_URL
    required: true
    description: "Connection string do Supabase/PostgreSQL..."
  - key: JWT_SECRET
    generateValue: true
  - key: SEED
    value: "false"
  - key: HOJE
    value: ""
```

### `backend/src/db.js`
- Schema/migrações/seed **só executam se `!process.env.DATABASE_URL`**
- Exporta stub vazio (`prepare/run/get/all` no-op) em modo PostgreSQL
- Mantém compatibilidade total com código existente

---

## Arquivos Inalterados (Já Prontos)

| Arquivo | Status |
|---------|--------|
| `supabase/schema.sql` | Schema PostgreSQL completo (idêntico ao SQLite) |
| `frontend/vercel.json` | Config Vercel com `VITE_API_URL` |
| `frontend/vite.config.ts` | Proxy `/api` → `:3001` em dev |

---

## Verificação Local (SQLite)

```bash
cd backend
npm install
HOJE=2026-10-25 SEED=true npm test
# SMOKE OK — spec §§1–9 + grade compartilhada/autorização admin verificados

npm start
# API em http://localhost:3001
```

## Deploy em Produção

### 1. Supabase
1. Criar projeto no [Supabase](https://supabase.com)
2. SQL Editor → executar `supabase/schema.sql`
3. Settings → Database → Connection string → **URI** → copiar `DATABASE_URL`

### 2. Render (Backend)
1. New Web Service → conectar repositório
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Environment Variables:
   - `DATABASE_URL` = (do Supabase, marcar como **Secret**)
   - `JWT_SECRET` = (gerar valor forte, ou deixar Render gerar)
   - `SEED` = `false`
   - `HOJE` = `""` (vazio = data real)
5. Health Check Path: `/api/health`

### 3. Vercel (Frontend)
1. Importar repositório
2. Framework Preset: Vite
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Environment Variable: `VITE_API_URL` = URL do serviço Render (ex: `https://saas-leds-api.onrender.com`)

---

## Riscos e Mitigação

| Risco | Mitigação |
|-------|-----------|
| Placeholders `?` vs `$n` | `db.unified.js` normaliza automaticamente |
| `INSERT OR IGNORE` falha no PG | Conversão para `ON CONFLICT DO NOTHING` |
| Transações assíncronas | Implementadas em ambos adaptadores |
| Seed/migrações rodam no PG | Guard `if (!DATABASE_URL)` no `db.js` e `db.unified.js` |
| `PRAGMA table_info` não existe no PG | Fallback para `information_schema.columns` |

---

## Estrutura de Branches/Commits

```
f7e7294 feat: adiciona controle de usuários com perfil e troca de senha
731735c deploy: corrige compatibilidade com Vercel, Render e Supabase
9559329 deploy: corrige configurações de Vercel, Render e Supabase
92fc3e5 sec: adiciona headers de segurança e corrige códigos de erro de autenticação
220eda7 docs: atualiza documentação de correções com componentes extraídos, testes e refresh token
```

**Commits desta refatoração** (não listados acima, são novos):
- `db.unified.js` criado
- `index.js` → imports + async/await fixes
- `render.yaml` → remove disk, DATABASE_URL required
- `db.js` → schema/seed only for SQLite
- `regras.js` → `getConfig` async

---

## Comandos Úteis Pós-Deploy

```bash
# Testar health check
curl https://saas-leds-api.onrender.com/api/health

# Testar dashboard (requer auth)
curl -H "Authorization: Bearer <token>" https://saas-leds-api.onrender.com/api/dashboard

# Ver logs no Render
# Dashboard → Logs → Live tail

# Ver logs no Supabase
# Dashboard → Logs → Database
```

---

## Próximos Passos (Opcionais)

1. **Migrar senhas para bcrypt** (já feito no seed, mas `usuarios.senha` em produção pode ter hashes antigos)
2. **Refatorar `App.tsx` monolítico** em componentes menores
3. **Adicionar testes de integração** com PostgreSQL real (CI/CD)
4. **Configurar backup automático** no Supabase (point-in-time recovery)
5. **Monitoramento**: Sentry, LogRocket, ou Render metrics