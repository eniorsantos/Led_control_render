# DOCUMENTAÇÃO DETALHADA — SaaS Controle de Veiculação LED

> Implementação exata da spec `spec-saas-controle-leds` (back-end + regras) com painel nas cores/elementos do `mockup-led-saas`.

---

## 1. Visão Geral

SaaS de **Controle de Veiculação em Painéis de LED** que permite gerenciar campanhas publicitárias em painéis de LED distribuídos por cidades. O sistema controla o ciclo completo das campanhas: cadastro de cidades e painéis (LEDs), criação de campanhas com anunciantes, definição de períodos de veiculação, múltiplas reservas por campanha, programação de grade horária (V3), controle de capacidade (espaços de cliente por LED), relatórios em PDF, exportação/importação de planilhas, backup/restauração do banco, gestão de usuários e perfis, notificações de início próximo e vencimento, e auditoria de operações.

**Origem dos dados:** planilha `CONTROLE_DE_LEDS.xlsx` — 4 painéis em Aracaju/SE (AJU 01…04), cada um com campanhas veiculando e reservadas.

**Público-alvo:** operadoras de mídia OOH (out-of-home) que gerenciam redes de painéis LED e precisam controlar quais anunciantes veiculam em cada painel, por quanto tempo, em quais horários e com qual capacidade de ocupação.

---

## 2. Stack Tecnológica

| Camada | Tecnologia | Versão | Observações |
|--------|-----------|--------|-------------|
| Front-end | Vite + React 18 + Recharts 2 | — | TypeScript, SPA, proxy `/api` → `:3001` em dev |
| Back-end | Node 22 + Express 4 | — | JavaScript puro, sem build step, servidor único |
| Banco de dados (dev) | SQLite via `better-sqlite3` | `^11.3.0` | Relacional, zero-config, arquivo `data.db` |
| Banco (produção) | Supabase / PostgreSQL | — | Via `db.unified.js` + driver `pg` (detecção automática via `DATABASE_URL`) |
| Autenticação | JWT (jsonwebtoken) | `^9.0.2` | Login/senha, token expira em 12h |
| CORS | cors | `^2.8.5` | Habilitado globalmente |
| Exportação XLSX | xlsx | `^0.18.5` | Geração de planilhas Excel |
| Geração PDF | pdfkit | `^0.20.2` | Relatórios por LED/cidade/cliente |
| Jobs / notificações | `setInterval` (24h) + execução no boot | — | Varredura diária de toasts |
| Estilização | CSS puro (variáveis CSS) | — | Paleta do mockup (`--bg:#0b1224`, `--teal:#2dd4bf`, etc.) |
| Build front-end | Vite | `^5.4.0` | `npm run build` → `dist/` |
| TypeScript | typescript | `^5.5.3` | Apenas checagem de tipos (`tsc --noEmit`) |

**Portas padrão:**
- Back-end API: `3001` (variável `PORT`)
- Front-end dev: `5173` (Vite), proxy `/api` → `http://localhost:3001`
- Front-end preview: `4173`
- Docker Compose (opcional): `8080` (Caddy/nginx)

---

## 3. Estrutura de Diretórios

```
S_LEDS/
├── README.md                      # Índice + guia rápido + deploy
├── DESIGN.md                      # Design system (cores, tipografia, componentes)
├── docs/                          # Documentação detalhada (01–10)
│   ├── 01-visao-geral.md
│   ├── 02-modelo-de-dados.md
│   ├── 03-regras-de-negocio.md
│   ├── 04-api.md
│   ├── 05-frontend.md
│   ├── 06-auth-permissoes.md
│   ├── 07-testes.md
│   ├── 08-correcoes.md
│   ├── 09-implantacao.md
│   └── 10-implantacao-docker.md
├── backend/
│   ├── package.json               # Scripts: start, dev, test
│   ├── package-lock.json
│   ├── data.db                    # Banco SQLite (criado no 1º boot, ignorado pelo git)
│   ├── src/
│   │   ├── index.js               # Rotas REST, auth, dashboard, export/import, backup, tema, logo
│   │   ├── db.js                  # Schema SQLite + seed + migrações + conexão
│   │   ├── db.supabase.js         # Adaptador assíncrono pg (opcional, p/ Supabase)
│   │   └── regras.js              # Regras de negócio puras (status, ocupação, grade, reservas)
│   └── test/
│       └── smoke.js               # Smoke test (14+ itens da spec)
├── frontend/
│   ├── package.json               # Scripts: dev, build, preview
│   ├── package-lock.json
│   ├── index.html
│   ├── tsconfig.json
│   ├── vite.config.ts             # Porta 5173 + proxy /api → :3001
│   ├── vercel.json                # Config de deploy na Vercel
│   ├── .env.example               # VITE_API_URL
│   └── src/
│       ├── main.tsx               # Bootstrap React
│       ├── App.tsx                # Todas as telas do painel (~1560 linhas)
│       ├── api.ts                 # Cliente HTTP + tipos + fallback offline (FALLBACK_DASH)
│       └── index.css              # Paleta e componentes do mockup
├── docker/
│   ├── docker-compose.yml         # Orquestração API + Web
│   ├── docker-compose.prod.yml
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   ├── Caddyfile
│   ├── nginx.conf
│   ├── .env.example
│   └── README.md
├── supabase/
│   └── schema.sql                 # Esquema PostgreSQL espelhando o modelo SQLite
└── .gitignore                     # node_modules, dist, data.db, *.db-*, .env, *.log
```

---

## 4. Modelo de Dados (spec §2 + §9)

O banco é relacional. Abaixo cada tabela, suas colunas e propósito.

### 4.1 `config`
Configurações globais do sistema (uma única linha, `id = 1`).

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | INTEGER PK | 1 | Sempre 1 |
| `n_inicio_proximo` | INTEGER | 7 | Dias para considerar "início próximo" (toast) |
| `n_vencimento_proximo` | INTEGER | 5 | Dias para considerar "vencimento próximo" (toast) |
| `max_clientes_por_led` | INTEGER | 8 | Capacidade padrão de espaços de cliente por LED |
| `logo_dataurl` | TEXT | `''` | Data URL da logo da empresa (exibida no login e topbar) |

### 4.2 `cidades`
Cidades onde existem painéis LED.

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | TEXT PK | — | Identificador fixo (ex.: `aracaju`, `salvador`) |
| `nome` | TEXT NOT NULL | — | Nome da cidade (ex.: `Aracaju`) |
| `uf` | TEXT | `''` | Unidade federativa (ex.: `SE`) |
| `fuso` | TEXT | `America/Maceio` | Fuso horário |

**Regra:** exclusão só permitida se a cidade estiver vazia (sem LEDs vinculados).

### 4.3 `leds`
Painéis de LED físicos.

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `codigo` | TEXT PK | — | Código do painel (ex.: `AJU 01`) |
| `endereco` | TEXT NOT NULL | — | Endereço/localização |
| `cidade_id` | TEXT FK → cidades(id) | — | Cidade a que pertence |
| `espacos_total` | INTEGER | NULL (usa padrão global) | Total de espaços de cliente individual; se NULL/vazio/0, usa `config.max_clientes_por_led` |

**Regras:**
- Renomear um LED move todas as campanhas e programações vinculadas (transação atômica).
- Exclusão só permitida se o LED estiver vazio (sem campanhas).
- Cada LED exibe selo `x/8` (ou total individual) de espaços ocupados.

### 4.4 `anunciantes`
Catálogo de anunciantes/clientes.

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `nome` | TEXT PK | — | Nome do anunciante (normalizado: espaços colapsados, trim) |

**Regra:** um anunciante pode aparecer em múltiplas campanhas/LEDs. A capacidade de um LED conta **anunciantes distintos não-vencidos**.

### 4.5 `campanhas`
Campanhas de veiculação (o núcleo do sistema).

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | TEXT PK | — | Identificador da campanha (ex.: `c1`, `imp-...`) |
| `cidade_id` | TEXT FK → cidades(id) | — | Cidade da campanha |
| `led_codigo` | TEXT FK → leds(codigo) | — | LED onde veicula |
| `anunciante` | TEXT FK → anunciantes(nome) | — | Anunciante da campanha |
| `inicio` | TEXT NOT NULL | — | Data de início (ISO `AAAA-MM-DD`) |
| `fim` | TEXT NOT NULL | — | Data de fim (ISO `AAAA-MM-DD`) |
| `reservada` | INTEGER | 0 | Flag: 1 = campanha reservada (futura), 0 = normal |

**Regras de validação:**
- `inicio` e `fim` devem ser datas ISO válidas (`31/9` é rejeitado — spec §1).
- `inicio` não pode ser posterior a `fim`.
- `led_codigo` deve pertencer à `cidade_id` informada (consistência cidade/LED).
- Capacidade: se o anunciante ainda não ocupa o LED e o LED está lotado → `409`.

### 4.6 `programacoes` (grade V3, spec §9.1)
Spots de programação horária para veiculação no LED.

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | TEXT PK | — | Identificador do spot |
| `campanha_id` | TEXT FK → campanhas(id) ON DELETE CASCADE | — | Campanha a que pertence |
| `led_codigo` | TEXT | — | LED de exibição |
| `horario_inicio` | TEXT NOT NULL | — | Horário `HH:MM` (00:00 a 23:59) |
| `duracao_segundos` | INTEGER | 15 | Duração do spot em segundos |
| `dias_semana` | TEXT | `SEG` | Dias da semana (ex.: `SEG`, `SEG,QUA,SEX`) |
| `insercoes_dia` | INTEGER | 1 | Quantidade de inserções por dia |
| `autorizado_por` | TEXT | NULL | Login do admin que autorizou sobreposição |
| `motivo_autorizacao` | TEXT | `''` | Motivo da autorização de sobreposição |

**Regras de sobreposição (grade compartilhada):**
- Duas campanhas podem dividir o mesmo LED/dia sem sobrepor os intervalos `[horário, horário+duração]`.
- Se houver sobreposição:
  - Usuário não-admin → `403` com `requer_autorizacao_admin: true`.
  - Admin sem confirmação → `409` com `requer_autorizacao_admin: true`.
  - Admin com `autorizacao_admin: true` + `motivo_autorizacao` → salvo com `autorizado_por` e evento `programacao.create.autorizada` na auditoria.

### 4.7 `reservas`
Múltiplos períodos futuros por campanha (spec §4.1).

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | TEXT PK | — | Identificador da reserva |
| `campanha_id` | TEXT FK → campanhas(id) ON DELETE CASCADE | — | Campanha vinculada |
| `inicio` | TEXT NOT NULL | — | Início do período reservado |
| `fim` | TEXT NOT NULL | — | Fim do período reservado |
| `anunciante` | TEXT | `''` | Anunciante da reserva (vazio = herda da campanha) |
| `criada_por` | TEXT | `''` | Login do usuário que criou |
| `criada_em` | TEXT | `datetime('now')` | Timestamp de criação |

**Regras:**
- Uma campanha pode ter N reservas, cada uma com seu próprio anunciante.
- Cada reserva gera um toast de início próximo na varredura diária.
- Reservas coexistem com o período da campanha e entre si (sem checagem de choque de datas).
- Rotação: reserva-only (sem campanha pai) pode criar automaticamente uma campanha reservada.

### 4.8 `usuários`
Usuários do sistema (login/senha).

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `login` | TEXT PK | — | Identificador de login |
| `senha` | TEXT NOT NULL | — | Senha em texto plano (ver Limitações) |
| `perfil` | TEXT | `visualizador` | `admin`, `regional`, `operador`, `visualizador` |
| `nome` | TEXT | `''` | Nome de exibição |

### 4.9 `usuario_cidade`
Vínculo usuário ↔ cidades visíveis.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `login` | TEXT FK → usuarios(login) ON DELETE CASCADE | Usuário |
| `cidade_id` | TEXT FK → cidades(id) ON DELETE CASCADE | Cidade visível |
| PK | (login, cidade_id) | — |

**Regra:** usuário sem cidades vinculadas vê todas (comportamento atual). Usuário com vínculos vê só essas cidades.

### 4.10 `permissoes`
Recursos extras concedidos por usuário (além do padrão do perfil).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `login` | TEXT FK → usuarios(login) ON DELETE CASCADE | Usuário |
| `recurso` | TEXT | ID do recurso (ex.: `exportar`, `usuarios`) |
| PK | (login, recurso) | — |

### 4.11 `tema`
Paleta de cores configurável (uma linha, `id = 1`).

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | INTEGER PK | 1 | Sempre 1 |
| `vars` | TEXT | `'{}'` | JSON com variáveis de cor (ex.: `{"teal": "#2dd4bf"}`) |

### 4.12 `notificacoes`
Toasts/notificações gerados pela varredura diária (spec §4.1).

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | INTEGER AUTOINCREMENT PK | — | Identificador |
| `campanha_id` | TEXT | — | ID sintético `grupo:<evento>:<anu>:<data>` ou ID da campanha/reserva |
| `evento` | TEXT NOT NULL | — | Tipo: `inicio`, `vencimento`, `res` |
| `titulo` | TEXT NOT NULL | — | Título do toast |
| `corpo` | TEXT NOT NULL | — | Corpo detalhado (lista LEDs, dias) |
| `dia` | TEXT NOT NULL | — | Data da notificação |
| `lida` | INTEGER | 0 | 0 = não lida, 1 = lida |
| `cidade_id` | TEXT | `''` | Cidade (para escopo da central) |
| `criada_em` | TEXT | `datetime('now')` | Timestamp |
| UNIQUE | (campanha_id, evento, dia) | — | Anti-duplicidade |

**Agrupamento:** campanhas com mesmo anunciante + mesma data de início geram um único toast (corpo lista todos os LEDs). Reservas: cada `(anunciante, início)` gera seu próprio grupo.

### 4.13 `auditoria`
Log de operações do sistema.

| Coluna | Tipo | Padrão | Descrição |
|--------|------|--------|-----------|
| `id` | INTEGER AUTOINCREMENT PK | — | Identificador |
| `quando` | TEXT | `datetime('now')` | Timestamp |
| `quem` | TEXT | `anon` | Login do usuário |
| `oque` | TEXT NOT NULL | — | Ação executada (ex.: `campanha.create`, `config.update`) |
| `detalhe` | TEXT | `''` | Detalhes adicionais em JSON ou texto |

---

## 5. Regras de Negócio Detalhadas

### 5.1 Status das Campanhas (spec §3)
O status deriva **somente das datas** em relação a "hoje" (`hojeISO`, data real local). A flag `reservada` nunca sobrepõe um período em curso.

| Status | Condição | Significado |
|--------|----------|-------------|
| `vencida` | `fim < hoje` | Campanha encerrada (passou do último dia) |
| `a_vencer` | `inicio <= hoje` e `0 <= fim - hoje <= n_vencimento_proximo` | Últimos dias de veiculação |
| `veiculando` | `inicio <= hoje <= fim` e não é `a_vencer` | No ar atualmente |
| `agendada` | `inicio > hoje` e `inicio - hoje > n_inicio_proximo` | Futura distante |
| `reservada` | `inicio > hoje` e `0 <= inicio - hoje <= n_inicio_proximo` | Próxima a iniciar |

**Nota:** `fim = hoje` ainda **não** é vencida (ainda está no último dia). `fim = ontem` é vencida.

### 5.2 Ocupação (spec §4.3)
Ocupação de um LED em um período = dias contratados no período ÷ dias totais do período × 100, limitado a 100%.

```js
ocupacao = min(100, (dias_contratados_union / dias_totais_periodo) * 100)
```

### 5.3 Capacidade de Espaços (spec §4.3)
Cada LED tem `max_clientes_por_led` (padrão 8) espaços de cliente. Um "espaço" é um **anunciante distinto com campanha não-vencida** (`fim >= hoje`) no LED.

- Se um anunciante novo tentar ocupar um LED lotado → `409` com detalhe `{ espacos: { usados, total } }`.
- `espacos_total` individual por LED sobrescreve o padrão global.
- Espaço individual `0` ou inválido é rejeitado (`400`).

### 5.4 Escopo por Cidade (spec §8.1)
Usuários não-admin com cidades vinculadas só podem ver/alterar dados daquelas cidades:
- Leitura: `filtroEfetivo` intersecciona cidades pedidas com cidades vinculadas.
- Escrita: `escopoCidadeOk` verifica se `cidade_id` está no vínculo do usuário (ou usuário não tem vínculos = todas).
- Aplica a campanhas, reservas, LEDs e spots (por ID ou payload).

### 5.5 Permissões (spec §9.2)

| Recurso | admin | regional | operador | visualizador |
|---------|-------|----------|----------|--------------|
| dashboard | ✓ | ✓ | ✓ | ✓ |
| planilha | ✓ | ✓ | ✓ | ✓ |
| graficos | ✓ | ✓ | ✓ | ✓ |
| leds | ✓ | ✓ | ✓ | — |
| cidades | ✓ | ✓ | ✓ | — |
| campanhas_editar | ✓ | ✓ | ✓ | — |
| reservas | ✓ | ✓ | ✓ | — |
| relatorios | ✓ | ✓ | ✓ | — |
| importar | ✓ | ✓ | — | — |
| exportar | ✓ | ✓ | — | — |
| notificacoes | ✓ | ✓ | ✓ | ✓ |
| usuarios | ✓ | — | — | — |
| config | ✓ | — | — | — |

Admin pode conceder recursos extras por usuário via tabela `permissoes`. Recursos extras **não excedem** o perfil (ex.: visualizador com `exportar` extra consegue exportar, mas não consegue `leds`).

**Middlewares de proteção:**
- `auth()` — exige JWT válido.
- `podeEditar` — admin/regional/operador.
- `soAdmin` — somente admin.
- `requer(recurso)` — verifica `permissoesEfetivas(login, perfil)`.

### 5.6 Grade Compartilhada V3 (spec §9.1)
Duas campanhas podem dividir a mesma grade (mesmo LED/dia) sem sobrepor intervalos. Com sobreposição, requer autorização de admin. O evento é auditado em `auditoria` com `oque = 'programacao.create.autorizada'`.

---

## 6. API REST (Endpoints)

Base: `http://localhost:3001/api` (ou `VITE_API_URL` em produção).

### 6.1 Autenticação

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| POST | `/api/auth/login` | Autentica login/senha, retorna JWT (12h) | Não |
| GET | `/api/me` | Retorna perfil, cidades vinculadas e recursos efetivos do usuário logado | Sim |

### 6.2 Configurações

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/config` | Retorna `hoje`, `n_inicio_proximo`, `n_vencimento_proximo`, `max_clientes_por_led`, `logo_dataurl` | Não | — |
| PUT | `/api/config` | Atualiza configurações globais | Sim | `config` |

### 6.3 Cidades

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/cidades` | Lista todas as cidades | Não (opcional) | — |
| POST | `/api/cidades` | Cria cidade (id, nome, uf, fuso) | Sim | `cidades` |
| PUT | `/api/cidades/:id` | Atualiza cidade (id fixo) | Sim | `cidades` |
| DELETE | `/api/cidades/:id` | Exclui cidade (só se vazia) | Sim | `cidades` |

### 6.4 LEDs

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/leds` | Lista LEDs com `espacos_usados`, `espacos_total`, `espacos_proprio` | Opcional | — |
| POST | `/api/leds` | Cria LED (codigo, endereco, cidade_id, espacos_total) | Sim | `leds` |
| PUT | `/api/leds/:codigo` | Atualiza/renomeia LED (move campanhas e spots) | Sim | `leds` |
| DELETE | `/api/leds/:codigo` | Exclui LED (só se vazio) | Sim | `leds` |

### 6.5 Anunciantes

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/anunciantes` | Lista anunciantes | Não |

### 6.6 Campanhas

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/campanhas` | Lista campanhas com status (filtro por cidade, led, status) | Opcional | — |
| POST | `/api/campanhas` | Cria campanha (valida datas, cidade/LED, capacidade) | Sim | `campanhas_editar` |
| PUT | `/api/campanhas/:id` | Edita campanha (inline da planilha) | Sim | `campanhas_editar` |
| DELETE | `/api/campanhas/:id` | Exclui campanha | Sim | `campanhas_editar` |
| DELETE | `/api/campanhas` | Exclusão em lote `{ids: []}` | Sim | `campanhas_editar` |

### 6.7 Reservas (por campanha)

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/campanhas/:id/reservas` | Lista reservas de uma campanha | Opcional | — |
| POST | `/api/campanhas/:id/reservas` | Cria reserva (inicio, fim, anunciante opcional) | Sim | `reservas` |
| DELETE | `/api/reservas/:id` | Exclui reserva | Sim | `reservas` |
| PUT | `/api/reservas/:id` | Atualiza reserva | Sim | `reservas` |

### 6.8 Reservas (menu global, por LED)

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/reservas` | Lista global de reservas (filtros: cidade, led, campanha) | Opcional | — |
| POST | `/api/reservas` | Cria reserva por LED (cria campanha reservada automaticamente se não houver) | Sim | `reservas` |

### 6.9 Programações (grade V3)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/programacoes` | Lista programações (filtro por led, campanha) | Opcional |
| POST | `/api/programacoes` | Cria spot com validação anti-sobreposição | Sim (`podeEditar`) |

### 6.10 Dashboard (§8.2)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/dashboard` | 4 KPIs, rosca, linha (6 meses), barras por cidade, Gantt por LED, listas a vencer / a iniciar | Opcional |

**KPIs:** `ocupacao_media`, `leds_ativos`, `a_vencer_7d`, `livres`, `espacos_total`.

### 6.11 Planilha (§4.4)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/planilha` | Linhas Cidade;LED;Anunciante;Início;Fim;Status (filtros: status, q) | Opcional |

### 6.12 Exportação (§8.3)

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/export/planilha.csv` | CSV com BOM, ponto-e-vírgula | Opcional | `exportar` |
| GET | `/api/export/planilha.xlsx` | XLSX via lib `xlsx` | Opcional | `exportar` |

### 6.13 Relatórios PDF

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| POST | `/api/relatorios/pdf` | PDF por dimensão (led, cidade, cliente), agrupado, datas pt-BR | Sim | `relatorios` |

**Body:** `{ dimensao, cidades[], status[], anunciante, de, ate }`

### 6.14 Importação de Planilha

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/import/modelo.csv` | Modelo CSV para importação | Não | — |
| POST | `/api/import/planilha` | Importa CSV no padrão Cidade;LED;Anunciante;Início;Fim[;Reservada][;ReservaN_...] | Sim | `importar` |

**Datas aceitas:** ISO (`2026-12-01`), BR (`01/12/26`), por extenso (`27/nov`). Ano rolado automaticamente se fim < início.

### 6.15 Notificações (§4.1)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/notificacoes` | Lista notificações (filtro por cidade) | Opcional |
| POST | `/api/notificacoes/varredura` | Executa varredura diária manualmente | Sim |
| PATCH | `/api/notificacoes/:id/lida` | Marca como lida | Sim |

### 6.16 Tema e Logo

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/tema` | Retorna variáveis de tema e rótulos | Não | — |
| PUT | `/api/tema` | Atualiza paleta de cores (admin) | Sim | `config` |
| GET | `/api/logo` | Retorna data URL da logo | Não | — |
| PUT | `/api/logo` | Salva logo (image, ≤512KB) | Sim | `config` |
| DELETE | `/api/logo` | Remove logo | Sim | `config` |

### 6.17 Usuários e Permissões (admin)

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/usuarios` | Lista usuários com cidades e recursos efetivos | Sim | `usuarios` |
| POST | `/api/usuarios` | Cria usuário (login, senha, perfil, cidades, permissoes) | Sim | `usuarios` |
| PUT | `/api/usuarios/:login` | Atualiza usuário | Sim | `usuarios` |
| DELETE | `/api/usuarios/:login` | Exclui usuário (não permite excluir a si mesmo) | Sim | `usuarios` |
| GET | `/api/recursos` | Catálogo de recursos disponíveis | Sim | — |

### 6.18 Backup e Restauração

| Método | Endpoint | Descrição | Auth | Recurso |
|--------|----------|-----------|------|---------|
| GET | `/api/backup` | Exporta todo o banco em JSON | Sim | `config` |
| POST | `/api/backup/restaurar` | Restaura banco a partir de JSON (substitui tudo) | Sim | `config` |

### 6.19 Health Check

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/health` | `{ ok: true }` | Não |

---

## 7. Front-end (Painel)

### 7.1 Arquitetura
- `App.tsx` é um componente único (~1560 linhas) que concentra todas as telas.
- `api.ts` é o cliente HTTP: usa `VITE_API_URL` se definido, senão faz requisições relativas (proxy do Vite em dev). Inclui `FALLBACK_DASH` para modo offline.
- `index.css` define variáveis CSS da paleta do mockup (`--bg:#0b1224`, `--teal:#2dd4bf`, `--orange:#f5943a`, `--red:#f0546a`, etc.).
- Recharts para gráficos (rosca, pizza, barras, linha).

### 7.2 Telas

| Tab / Seção | Descrição | Recurso necessário |
|-------------|-----------|--------------------|
| Login | Autenticação admin/regional/operador/viewer | Nenhuma (pública) |
| Dashboard | 4 KPIs, rosca de distribuição, linha (evolução mensal), barras por cidade, Gantt por LED, listas a vencer / a iniciar | `dashboard` |
| Planilha | Tabela de campanhas com busca, filtro por status, edição inline (anunciante/início/fim), exclusão em lote, export CSV/XLSX, PDF (window.print) | `planilha`, `exportar` (opcional) |
| Gráficos | Evolução mensal (%) e ocupação por cidade (%) via Recharts | `graficos` |
| Reservas | Múltiplos períodos futuros por campanha, cada um com anunciante e toast de início próximo | `reservas` |
| Relatórios | Filtro por dimensão (LED/cidade/cliente), cidade, LED, cliente, status, período → geração de PDF | `relatorios` |
| Configuração > Acesso | CRUD de usuários, cidades vinculadas, recursos extras por usuário | `usuarios` |
| Configuração > Cidades | CRUD de cidades (id, nome, UF, fuso) | `cidades` |
| Configuração > Cores | Editor de paleta com input de cor, salvar/restaurar padrão | `config` |
| Configuração > Logo | Upload de imagem (≤512KB), salvar/remover | `config` |
| Configuração > Importar | Upload de CSV, download do modelo, mensagem de importadas/ignoradas | `importar` |
| Configuração > Backup | Baixar backup JSON, restaurar backup (substitui tudo) | `config` |

### 7.3 Componentes Principais
- `ToastItem` — toast arrastável (pelo título), com botões "Ver campanha" e "Fechar".
- `ganttBlocos` — renderiza blocos de campanha no Gantt por LED (veiculando, reservada, vencida, livre).
- `conteudoUsuarios` — tabela de usuários com formulário de criação/edição (perfil, cidades, recursos).
- `conteudoCidades` — tabela de cidades com formulário de criação/edição.
- `conteudoReservas` — tabela global de reservas + formulário de nova reserva.

### 7.4 Atalhos de Teclado
- `Ctrl+N` (ou `Cmd+N`) — nova campanha (se `podeEditar`).
- `Ctrl+S` (ou `Cmd+S`) — salvar edição inline (se `editInline` ativo).
- `Escape` — cancela edição inline ou fecha modal.

### 7.5 Modo Offline
Se a API não estiver disponível, o painel exibe:
- Badge `OFFLINE` no topbar.
- `FALLBACK_DASH` (zeros e listas vazias — nenhum dado fictício).
- Telas vazias com aviso "Sem dados - API offline. Ligue o back-end para carregar."
- Login com fallback: se falhar, entra em modo offline (`token = 'offline'`).

### 7.6 Filtro de Cidade
O seletor de cidade no topbar filula dashboard, planilha, Gantt, LEDs, reservas e notificações. A URL é atualizada via `history.replaceState` com parâmetro `?cidades=<id>`.

---

## 8. Autenticação e Permissões (spec §9.2)

### 8.1 Perfis
| Perfil | Descrição |
|--------|-----------|
| `admin` | Acesso total a todos os recursos |
| `regional` | Gestão regional: quase todos os recursos exceto usuários e config |
| `operador` | Operação: dashboard, planilha, LEDs, cidades, campanhas, reservas, relatórios, notificações |
| `visualizador` | Somente leitura: dashboard, planilha, gráficos, notificações |

### 8.2 Login Demo
| Login | Senha | Perfil |
|-------|-------|--------|
| `admin` | `admin123` | admin |
| `regional` | `reg123` | regional |
| `operador` | `op123` | operador |
| `viewer` | `view123` | visualizador |

### 8.3 Admin de Resgate
Se o banco for criado sem nenhum usuário, o sistema cria automaticamente `admin/admin123` como administrador de resgate. Isso garante que sempre seja possível fazer login para criar outros usuários.

### 8.4 JWT
- Assinado com `JWT_SECRET`.
- Expira em 12h.
- Armazenado em `localStorage` (`led_token`, `led_perfil`).
- Em caso de 401, o front-end remove o token e recarrega com hash `#sessao-expirada`.

---

## 9. Notificações e Jobs (spec §4.1)

### 9.1 Varredura Diária
Função `varreduraNotificacoes(db)`:
- Executa no boot e a cada 24h (`setInterval`).
- Para cada campanha:
  - `vencimento`: se `0 <= fim - hoje <= n_vencimento_proximo` e `inicio <= hoje`.
  - `inicio`: se `0 <= inicio - hoje <= n_inicio_proximo` e `inicio > hoje`.
- Para cada reserva:
  - `inicio`: se `0 <= inicio - hoje <= n_inicio_proximo`.
- Agrupamento: campanhas com mesmo anunciante + mesma data de início = 1 toast (corpo lista todos os LEDs).
- Anti-duplicidade: UNIQUE `(campanha_id, evento, dia)` + ID sintético `grupo:<evento>:<anu>:<data>`.
- Podagem de notificações órfãs (`podarNotificacoesOrfas`): remove notificações de campanhas/reservas que não existem mais.

### 9.2 Central de Notificações
- Sino no topbar com contador de pendentes.
- Painel dropdown com últimas 20 notificações.
- Botão "Marcar como lida" (atualiza `lida = 1` e estado local).
- Botão "fechar todas" quando há mais de 1 pendente.

---

## 10. Importação e Exportação

### 10.1 Exportação (§8.3)
Exporta exatamente a view atual da planilha (mesmos filtros: cidade, busca, status).
- CSV: BOM UTF-8, separador ponto-e-vírgula, colunas `Cidade;LED;Anunciante;Início;Fim;Status`.
- XLSX: via lib `xlsx`, aba "Veiculação".

### 10.2 Importação
Padrão CSV: `Cidade;LED;Anunciante;Início;Fim[;Reservada][;ReservaN_Anunciante;ReservaN_Início;ReservaN_Fim…]`

**Recursos do importador:**
- Detecção automática de delimitador (`;` ou `,`).
- Normalização de chaves de cabeçalho (remove acentos, caracteres não alfanuméricos).
- Suporte a múltiplas reservas por linha (`Reserva1_...`, `Reserva2_...`, etc.).
- Formatos de data: ISO, BR (`01/12/26`), por extenso (`27/nov`).
- Rolagem de ano: se fim < início, adiciona 1 ano ao fim (ex.: `01/09/2026 → 28/02/2026` vira `28/02/2027`).
- Diária única: se só um lado da data preenchido, usa a mesma data para início e fim.
- Detecção de duplicatas: mesma campanha (mesmo LED + anunciante + início) não é recriada.
- Checagem de capacidade (lotado → ignorada).
- Escopo por cidade respeitado.
- Relatório de retorno: `{ total, criadas, reservas_criadas, ignoradas: [{linha, anunciante, motivo}] }`.

---

## 11. Backup e Restauração

- **Backup:** `GET /api/backup` retorna JSON com todas as tabelas (`{ tabelas: { ... } }`). Arquivo baixado: `backup-led.json`.
- **Restauração:** `POST /api/backup/restaurar` recebe o JSON e substitui todo o banco. Exibe contagem de campanhas e reservas restauradas.
- **Aviso:** restaurar substitui tudo. Recomenda-se fazer backup antes.
- Validação: corpo inválido ou sem chave `tabelas` → `400`.

---

## 12. Tema e Logo

### 12.1 Tema
Variáveis de cor armazenadas na tabela `tema` (JSON). Editáveis via UI na aba "Cores" da Configuração:
- Aplica imediatamente nas variáveis CSS (`--teal`, `--border`, `--muted`, etc.).
- Botão "Restaurar padrão" volta para os valores do mockup.
- Somente admin pode editar tema.

### 12.2 Logo
- Imagem exibida no lugar do ícone 📺 no login e topbar.
- Tamanho fixo 38px.
- Validação: deve ser `image/*` e ≤ 512KB.
- Persistida como data URL na tabela `config` (`logo_dataurl`).
- Somente admin pode trocar/remover.

---

## 13. Deploy

### 13.1 Deploy Unificado — Render Blueprint (Recomendado)
Arquivo: `render.yaml` (raiz do projeto)

O blueprint cria **dois serviços linkados** em um único passo:

1. **Backend** → Web Service (Node/Express) — `saas-leds-api`
2. **Frontend** → Static Site (Vite/React) — `saas-leds-frontend`

#### Como usar:
1. Push para GitHub (`eniorsantos/Led_control_render`)
2. No Render Dashboard → **New +** → **Blueprint**
3. Conecte o repo e clique **Apply**
4. O Render cria os dois serviços e injeta `VITE_API_URL` no frontend apontando para o backend
5. No serviço **saas-leds-api** → **Environment** → adicione `DATABASE_URL` (Secret) com a connection string do Supabase

#### Configuração do `render.yaml`:
```yaml
services:
  # Backend: Web Service
  - type: web
    name: saas-leds-api
    env: node
    rootDir: backend
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: JWT_SECRET
        generateValue: true
      - key: PORT
        value: "3001"
      - key: NODE_ENV
        value: production
      - key: SEED
        value: "false"
      - key: DATABASE_URL
        required: true

  # Frontend: Static Site (Vite + React)
  - type: static
    name: saas-leds-frontend
    rootDir: frontend
    buildCommand: npm ci && npm run build
    staticPublishPath: ./dist
    envVars:
      - key: VITE_API_URL
        fromService:
          type: web
          name: saas-leds-api
          property: host
        transform: "https://${value}/api"
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    headers:
      - path: /assets/*
        name: Cache-Control
        value: "public, max-age=31536000, immutable"
```

#### URLs resultantes:
| Serviço | URL |
|---------|-----|
| Backend API | `https://saas-leds-api.onrender.com/api` |
| Frontend | `https://saas-leds-frontend.onrender.com` |

---

### 13.2 Front-end — Vercel (Alternativo)
Arquivo: `frontend/vercel.json`

1. Importe a pasta `frontend/` na Vercel.
2. Defina variável de ambiente: `VITE_API_URL=https://saas-leds-api.onrender.com/api`.
3. Build: `npm run build` → `dist/`.
4. O `vercel.json` configura build estático com fallback SPA para `/index.html`.

---

### 13.3 Back-end — Render (Manual / Web Service apenas)
Arquivo: `backend/render.yaml` (legado)

1. Crie um Web Service na Render importando `backend/`.
2. Build: `npm install`.
3. Start: `npm start`.
4. **Sem disco persistente** (usa Supabase/PostgreSQL).
5. Health check: `/api/health`.
6. Variáveis de ambiente obrigatórias:
   - `DATABASE_URL` — Connection string do Supabase/PostgreSQL (**obrigatório**, marcar como Secret).
   - `JWT_SECRET` — Gere um segredo forte (Render pode gerar automaticamente).
   - `SEED=false` — Produção nasce vazia.
   - `HOJE` — (opcional) Data fixa para testes; vazio = data real do servidor.

> **Nota:** O deploy com SQLite + disco persistente ainda funciona localmente, mas **não é mais suportado em produção** na Render. Use Supabase/PostgreSQL.

---

### 13.4 Banco — Supabase (Produção)
Arquivo: `supabase/schema.sql`

1. Crie projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no editor SQL.
3. No Supabase: Settings → Database → Connection string → **URI** → copie.
4. No Render: adicione `DATABASE_URL` (Secret) com a string copiada.
5. **Nenhuma alteração de código necessária** — `db.unified.js` detecta `DATABASE_URL` automaticamente e usa `pg` (PostgreSQL) em produção, ou `better-sqlite3` (SQLite) em desenvolvimento local.

---

### 13.4.1 **IMPORTANTE: Seed de Usuários no Supabase (Login não funciona sem isso)**

> ⚠️ **O seed de usuários (`admin/admin123`, `regional/reg123`, etc.) SÓ roda no SQLite local.**
> No PostgreSQL/Supabase, a tabela `usuarios` fica **vazia** após rodar o `schema.sql`.
> **Você deve inserir os usuários manualmente no Supabase SQL Editor** para o login funcionar.

#### **Passo a passo para corrigir o login em produção:**

**1. Gere os hashes bcrypt corretos (no seu terminal local com Node.js):**
```bash
node -e "console.log('admin:', require('bcrypt').hashSync('admin123', 10))"
node -e "console.log('regional:', require('bcrypt').hashSync('reg123', 10))"
node -e "console.log('operador:', require('bcrypt').hashSync('op123', 10))"
node -e "console.log('viewer:', require('bcrypt').hashSync('view123', 10))"
```

**2. Execute no Supabase SQL Editor (substitua os hashes pelos gerados acima):**
```sql
-- Inserir usuários com hashes bcrypt compatíveis com Node.js
INSERT INTO usuarios (login, senha, perfil, nome) VALUES
  ('admin',    '$2b$10$SEU_HASH_ADMIN_AQUI',    'admin',        'Administrador'),
  ('regional', '$2b$10$SEU_HASH_REGIONAL_AQUI', 'regional',     'Gestor Regional'),
  ('operador', '$2b$10$SEU_HASH_OPERADOR_AQUI', 'operador',     'Operador'),
  ('viewer',   '$2b$10$SEU_HASH_VIEWER_AQUI',   'visualizador', 'Visualizador')
ON CONFLICT (login) DO UPDATE SET
  senha = EXCLUDED.senha,
  perfil = EXCLUDED.perfil,
  nome = EXCLUDED.nome;

-- Vincular regional à cidade Aracaju (escopo de visibilidade)
INSERT INTO usuario_cidade (login, cidade_id) VALUES ('regional', 'aracaju')
ON CONFLICT DO NOTHING;
```

**3. Verifique se funcionou:**
```sql
-- Deve retornar TRUE para todas as 4 colunas
SELECT
  login,
  crypt('admin123', senha) = senha as admin_ok,
  crypt('reg123', senha) = senha as regional_ok,
  crypt('op123', senha) = senha as operador_ok,
  crypt('view123', senha) = senha as viewer_ok
FROM usuarios
WHERE login IN ('admin','regional','operador','viewer');
```

#### **Diagnóstico rápido se login ainda falhar:**
```sql
-- 1. Verificar usuários e tipo de hash
SELECT login, perfil,
       CASE WHEN senha LIKE '$2b$%' THEN 'bcrypt' ELSE 'outro/inválido' END as tipo,
       left(senha, 30) as preview
FROM usuarios;

-- 2. Testar comparação bcrypt direta (precisa pgcrypto)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT login, crypt('admin123', senha) = senha as senha_ok
FROM usuarios WHERE login = 'admin';

-- 3. Verificar case sensitivity (Postgres é case-sensitive!)
SELECT login, login = 'admin' as exato
FROM usuarios WHERE lower(login) = 'admin';
```

#### **Causas comuns de "credenciais inválidas" no Supabase:**
| Causa | Sinal | Solução |
|-------|-------|---------|
| Hash gerado por outra lib (Python, Go, etc.) | `crypt()` retorna `false` | Regere com `bcrypt.hashSync()` do Node.js |
| Login maiúsculo no banco (`Admin` vs `admin`) | `login = 'admin'` retorna `false` | Corrija para minúsculo: `UPDATE usuarios SET login = lower(login)` |
| Extensão `pgcrypto` não habilitada | `crypt()` erro | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` |
| Usuário não existe (seed não rodou) | Tabela vazia | Execute o INSERT acima |

---

### 13.5 Desenvolvimento Local (SQLite)
O projeto roda **100% local** sem configuração extra:

```bash
cd backend
npm install
npm start           # API :3001 (SQLite em ./data.db)

cd ../frontend
npm install
npm run dev         # :5173 (proxy /api → :3001)
```

- `SEED=true` popula dataset demo (inclui `admin/admin123`).
- `HOJE=2026-10-25` fixa data lógica para testes reproduzíveis.
- Admin de resgate: se banco não tiver usuários, cria `admin/admin123` automaticamente.

---

## 14. Variáveis de Ambiente

### Back-end (`backend/.env.example`)
| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3001` | Porta da API |
| `JWT_SECRET` | `led-control-dev-mude-em-producao` | Segredo do JWT (obrigatório em prod) |
| `HOJE` | (vazio) | Data lógica (data real se vazio). Use para simular/testar |
| `SEED` | (vazio) | `true` popula dataset demo no 1º boot |
| `DB_PATH` | `./data.db` | Caminho do SQLite (no Render: `/data/data.db`) |
| `DATABASE_URL` | (vazio) | Connection string p/ Supabase/PostgreSQL (opcional) |

### Front-end (`frontend/.env.example`)
| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `VITE_API_URL` | (vazio) | URL pública do back-end (Render). Vazio = proxy local do Vite |

---

## 15. Como Rodar Localmente

```powershell
# Back-end
cd backend
npm install
npm start           # http://localhost:3001

# Front-end (novo terminal)
cd frontend
npm install
npm run dev         # http://localhost:5173 (proxy /api → :3001)
```

### Smoke Test
```powershell
cd backend
$env:HOJE='2026-10-25'; $env:SEED='true'
npm test            # node test/smoke.js
```
Valida: health, dashboard KPIs, LED filtrados por cidade, planilha ≥ 8 campanhas, login admin emite JWT, validação de data 31/9 rejeitada, anti-sobreposição grade V3, autorização admin, capacidade 8 espaços/LED, CRUD de LEDs/cidades/usuários, múltiplas reservas, varredura de notificações, agrupamento de toasts, importação, backup/restauração, logo, relatórios PDF, escopo por cidade.

Saída esperada: `SMOKE OK — spec §§1–9 + grade compartilhada/autorização admin verificados`.

---

## 16. Limitações e Pontos de Atenção

| Item | Descrição |
|------|-----------|
| **Senhas em texto plano** | `usuarios.senha` é armazenada e comparada em texto plano. Para produção, migrar para bcrypt/argon2. (Seed já usa `bcrypt.hashSync`). |
| **App.tsx monolítico** | ~1560 linhas em um único componente. Candidato a refatoração em componentes menores. |
| **Banco SQLite versionado** | `data.db` está no `.gitignore` mas pode existir fisicamente se `npm start` rodou localmente. Não commitado. |
| ~~**Adaptador Supabase não integrado**~~ | **RESOLVIDO:** `db.unified.js` detecta `DATABASE_URL` e usa `pg` (PostgreSQL) ou `better-sqlite3` (SQLite) automaticamente. `db.supabase.js` mantido para referência mas não usado. |
| **Sem refresh token** | JWT expira em 12h; não há rota de refresh. O usuário precisa logar novamente. |
| **Sem 2FA / SSO** | Spec menciona futuros, mas não implementado. |
| **Reservas sem checagem de choque** | Reservas coexistem com campanha e entre si sem validação de sobreposição de datas (por design da spec). |
| **Cidades sem vínculo = todas** | Usuário não-admin sem cidades vinculadas vê todas as cidades (comportamento atual, pode ser ajustado). |

---

## 17. Scripts npm

### Back-end
| Script | Comando | Descrição |
|--------|---------|-----------|
| `start` | `node src/index.js` | Inicia API na porta 3001 |
| `dev` | `node src/index.js` | Mesma coisa (dev) |
| `test` | `node test/smoke.js` | Smoke test da spec |

### Front-end
| Script | Comando | Descrição |
|--------|---------|-----------|
| `dev` | `vite` | Servidor dev na porta 5173 com proxy `/api` |
| `build` | `tsc --noEmit && vite build` | Checagem de tipos + build para `dist/` |
| `preview` | `vite preview --port 4173` | Preview local do build |

---

## 18. Licença e Origem

Implementação exata de `spec-saas-controle-leds` com UI baseada em `mockup-led-saas`. Dados de exemplo originados da planilha `CONTROLE_DE_LEDS.xlsx` (4 painéis em Aracaju/SE).
