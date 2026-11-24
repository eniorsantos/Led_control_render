# AGENTS.md — SaaS Controle de Veiculação LED

## Resumo
Painel SaaS para gerenciar campanhas de veiculação em painéis de LED por cidade. Back-end Node+Express+SQLite, front-end Vite+React+Recharts.

## Comandos principais
```powershell
# Back-end
cd backend; npm install; npm start      # API :3001
cd backend; $env:HOJE='2026-10-25'; $env:SEED='true'; npm test  # smoke

# Front-end
cd frontend; npm install; npm run dev   # :5173 (proxy /api → :3001)
```

## Estrutura de código
- `backend/src/index.js` — rotas REST, auth, dashboard, export/import, backup, tema, logo
- `backend/src/db.unified.js` — **NOVO**: camada unificada SQLite/PostgreSQL (detecta `DATABASE_URL`)
- `backend/src/db.js` — schema SQLite + seed + migrações (só roda se `!DATABASE_URL`)
- `backend/src/db.supabase.js` — adaptador pg legado (mantido p/ referência, não usado)
- `backend/src/regras.js` — regras de negócio (status, ocupação, grade V3, reservas, notificações)
- `backend/test/smoke.js` — smoke test da spec
- `frontend/src/App.tsx` — todas as telas (~1560 linhas, monolítico)
- `frontend/src/api.ts` — cliente HTTP + tipos + fallback offline

## Login demo
`admin/admin123`, `regional/reg123`, `operador/op123`, `viewer/view123`

## Novos recursos (2026-11)
- **Bootstrap Admin**: `POST /api/auth/bootstrap-admin` — cria o primeiro admin sem auth (só funciona se não houver admin). Frontend: link "Criar primeiro admin" na tela de login.
- **Refresh Token**: `POST /api/auth/refresh` — rotação de refresh token (7 dias), renovação automática no frontend.

## Deploy
- **Recomendado:** Render Blueprint (`render.yaml` na raiz) — cria **Backend (Web Service)** + **Frontend (Static Site)** linkados em um passo. Só precisa definir `DATABASE_URL` no backend após o deploy.
- Front-end (alternativo): Vercel (`frontend/vercel.json`, `VITE_API_URL`)
- Back-end (manual): Render (`backend/render.yaml`, **sem disco persistente**, `DATABASE_URL` obrigatório, `JWT_SECRET`)
- Banco: Supabase/PostgreSQL (`supabase/schema.sql`, `DATABASE_URL` secret no Render)

> ⚠️ **Crítico (Supabase + Render):** Use **obrigatoriamente** a connection string do **Session pooler** (porta 5432) ou **Transaction pooler** (porta 6543) — **NÃO a "Direct connection"**. A Direct connection usa IPv6 e falha na Render com `ENETUNREACH`. Pooler = IPv4 ✅.

## Pontos de atenção
1. Senhas em texto plano (`usuarios.senha`) — seed usa bcrypt, mas produção deve migrar.
2. `App.tsx` monolítico — refatorar em componentes menores.
3. `data.db` está no `.gitignore` (não commitado).
4. ~~`db.supabase.js` existe mas não está conectado ao `index.js`~~ **RESOLVIDO**: `db.unified.js` substitui.
5. ~~Sem refresh token~~ **RESOLVIDO**: implementado `/api/auth/refresh` com rotação.

## Documentação detalhada
`docs/11-documentacao-detalhada.md` — modelo de dados, regras, API completa, front-end, deploy, variáveis de ambiente, limitações.
