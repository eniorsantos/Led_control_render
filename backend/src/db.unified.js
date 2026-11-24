// Camada unificada de acesso a dados — SQLite (local) + PostgreSQL/Supabase (produção)
// Detecta DATABASE_URL automaticamente e expõe API assíncrona uniforme para ambos.
// Uso: const db = require('./db.unified') — substitui db.adapter e db.supabase

const path = require('path');
const USING_POSTGRES = !!process.env.DATABASE_URL;

let pool, sqliteDb;

if (USING_POSTGRES) {
  // ---------- PostgreSQL / Supabase ----------
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // Configurações para serverless (Render) + Supabase pooler
    max: 10,                    // Máximo de conexões no pool
    idleTimeoutMillis: 30000,   // Fecha conexões ociosas após 30s
    connectionTimeoutMillis: 5000, // Timeout para nova conexão
    maxUses: 7500,              // Rotaciona conexão após N usos (evita memory leaks)
    allowExitOnIdle: true,      // Permite fechar pool se app idle
  });
  // Log de eventos do pool para debug
  pool.on('error', (err) => console.error('[PG Pool] erro inesperado:', err.message));
  pool.on('connect', () => console.log('[PG Pool] nova conexão'));
  pool.on('remove', () => console.log('[PG Pool] conexão removida'));

  // Normaliza placeholders ? → $1, $2... para pg
  // Converte INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  // Converte INSERT OR REPLACE → INSERT ... ON CONFLICT (...) DO UPDATE SET ...
  function normalizeSql(sql) {
    let idx = 0;
    let normalized = sql.replace(/\?/g, () => `$${++idx}`);

    if (USING_POSTGRES) {
      // INSERT OR IGNORE INTO table (cols) VALUES (...) → INSERT INTO table (cols) VALUES (...) ON CONFLICT DO NOTHING
      normalized = normalized.replace(
        /INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
        (_, table, cols, values) => `INSERT INTO ${table} (${cols}) VALUES (${values}) ON CONFLICT DO NOTHING`
      );

      // INSERT OR REPLACE INTO table (cols) VALUES (...) → INSERT INTO table (cols) VALUES (...) ON CONFLICT (pk) DO UPDATE SET ...
      // Para tabelas com PK simples (id, login, codigo, nome), assume primeira coluna como PK
      normalized = normalized.replace(
        /INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
        (_, table, cols, values) => {
          const firstCol = cols.split(',')[0].trim();
          const updateCols = cols.split(',').map(c => c.trim()).filter(c => c !== firstCol);
          const setClause = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
          return `INSERT INTO ${table} (${cols}) VALUES (${values}) ON CONFLICT (${firstCol}) DO UPDATE SET ${setClause}`;
        }
      );
    }

    return normalized;
  }

  async function pgQuery(sql, params = []) {
    const res = await pool.query(normalizeSql(sql), params);
    return res.rows;
  }
  async function pgGet(sql, params = []) {
    const rows = await pgQuery(sql, params);
    return rows[0] || null;
  }
  async function pgRun(sql, params = []) {
    const res = await pool.query(normalizeSql(sql), params);
    return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id || null };
  }
  function pgPrepare(sql) {
    const norm = normalizeSql(sql);
    return {
      async run(...params) { return pgRun(norm, params); },
      async get(...params) { return pgGet(norm, params); },
      async all(...params) { return pgQuery(norm, params); },
    };
  }
  async function pgTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txPrepare = (s) => {
        const norm = normalizeSql(s);
        return {
          async run(...p) { return (await client.query(norm, p)).rowCount; },
          async get(...p) { const r = await client.query(norm, p); return r.rows[0] || null; },
          async all(...p) { const r = await client.query(norm, p); return r.rows; },
        };
      };
      const result = await fn(txPrepare);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  // PRAGMA table_info → information_schema.columns
  async function getTableColumns(table) {
    const sql = `
      SELECT column_name AS name, data_type AS type, is_nullable AS "notnull", column_default AS dflt_value
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `;
    return pgQuery(sql, [table]);
  }

  module.exports = {
    pool,
    query: pgQuery,
    get: pgGet,
    run: pgRun,
    prepare: pgPrepare,
    transaction: pgTransaction,
    getTableColumns,
    isUsingPostgres: () => true,
    USING_POSTGRES: true,
  };
} else {
  // ---------- SQLite (better-sqlite3) ----------
  const Database = require('better-sqlite3');
  sqliteDb = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data.db'));

  // Create schema if not exists
  sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    n_inicio_proximo INTEGER NOT NULL DEFAULT 7,
    n_vencimento_proximo INTEGER NOT NULL DEFAULT 5,
    max_clientes_por_led INTEGER NOT NULL DEFAULT 8,
    logo_dataurl TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS cidades (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, uf TEXT NOT NULL DEFAULT '', fuso TEXT NOT NULL DEFAULT 'America/Maceio'
  );
  CREATE TABLE IF NOT EXISTS leds (
    codigo TEXT PRIMARY KEY, endereco TEXT NOT NULL, cidade_id TEXT NOT NULL REFERENCES cidades(id),
    espacos_total INTEGER
  );
  CREATE TABLE IF NOT EXISTS anunciantes ( nome TEXT PRIMARY KEY );
  CREATE TABLE IF NOT EXISTS campanhas (
    id TEXT PRIMARY KEY, cidade_id TEXT NOT NULL REFERENCES cidades(id),
    led_codigo TEXT NOT NULL REFERENCES leds(codigo), anunciante TEXT NOT NULL REFERENCES anunciantes(nome),
    inicio TEXT NOT NULL, fim TEXT NOT NULL, reservada INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS programacoes (
    id TEXT PRIMARY KEY, campanha_id TEXT NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
    led_codigo TEXT NOT NULL, horario_inicio TEXT NOT NULL, duracao_segundos INTEGER NOT NULL DEFAULT 15,
    dias_semana TEXT NOT NULL DEFAULT 'SEG', insercoes_dia INTEGER NOT NULL DEFAULT 1,
    autorizado_por TEXT, motivo_autorizacao TEXT
  );
  CREATE TABLE IF NOT EXISTS usuarios (
    login TEXT PRIMARY KEY, senha TEXT NOT NULL, perfil TEXT NOT NULL DEFAULT 'visualizador', nome TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS usuario_cidade (
    login TEXT NOT NULL REFERENCES usuarios(login) ON DELETE CASCADE,
    cidade_id TEXT NOT NULL REFERENCES cidades(id) ON DELETE CASCADE,
    PRIMARY KEY (login, cidade_id)
  );
  CREATE TABLE IF NOT EXISTS permissoes (
    login TEXT NOT NULL REFERENCES usuarios(login) ON DELETE CASCADE,
    recurso TEXT NOT NULL,
    PRIMARY KEY (login, recurso)
  );
  CREATE TABLE IF NOT EXISTS tema (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    vars TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS reservas (
    id TEXT PRIMARY KEY, campanha_id TEXT NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
    inicio TEXT NOT NULL, fim TEXT NOT NULL, anunciante TEXT NOT NULL DEFAULT '',
    criada_por TEXT NOT NULL DEFAULT '', criada_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS notificacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, campanha_id TEXT NOT NULL, evento TEXT NOT NULL,
    titulo TEXT NOT NULL, corpo TEXT NOT NULL, dia TEXT NOT NULL, lida INTEGER NOT NULL DEFAULT 0,
    cidade_id TEXT NOT NULL DEFAULT '',
    criada_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (campanha_id, evento, dia)
  );
  CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT, quando TEXT NOT NULL DEFAULT (datetime('now')),
    quem TEXT NOT NULL DEFAULT 'anon', oque TEXT NOT NULL, detalhe TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    login TEXT NOT NULL REFERENCES usuarios(login) ON DELETE CASCADE,
    expira_em TEXT NOT NULL,
    criada_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  // Seed (only if SEED=true)
  if (process.env.SEED === 'true' || process.env.SEED === '1') {
    const bcrypt = require('bcrypt');
    const n = sqliteDb.prepare('SELECT COUNT(*) v FROM cidades').get().v;
    sqliteDb.prepare('INSERT OR IGNORE INTO config (id) VALUES (1)').run();
    if (n === 0) {
      const ins = (sql, rows) => {
        const s = sqliteDb.prepare(sql);
        for (const r of rows) s.run(...r);
      };
      ins('INSERT OR IGNORE INTO cidades (id,nome,uf) VALUES (?,?,?)', [
        ['aracaju', 'Aracaju', 'SE'],
        ['salvador', 'Salvador', 'BA'],
      ]);
      ins('INSERT OR IGNORE INTO leds (codigo,endereco,cidade_id) VALUES (?,?,?)', [
        ['AJU 01', 'Silvio Teixeira', 'aracaju'],
        ['AJU 02', 'Tancredo Neves', 'aracaju'],
        ['AJU 03', 'Adélia Franco', 'aracaju'],
        ['AJU 04', 'Francisco Porto', 'aracaju'],
      ]);
      ins('INSERT OR IGNORE INTO anunciantes (nome) VALUES (?)', [
        ['Atakarejo'],
        ['Vita'],
        ['Diniz Fonseca'],
        ['Jardins Delicatessen'],
        ['Boticário'],
        ['Hospital dos Olhos'],
        ['Rede Primavera'],
        ['São Braz'],
      ]);
      ins(
        'INSERT OR IGNORE INTO campanhas (id,cidade_id,led_codigo,anunciante,inicio,fim,reservada) VALUES (?,?,?,?,?,?,?)',
        [
          ['c1', 'aracaju', 'AJU 01', 'Atakarejo', '2026-02-10', '2027-04-09', 0],
          ['c2', 'aracaju', 'AJU 01', 'Boticário', '2026-11-14', '2026-11-28', 1],
          ['c3', 'aracaju', 'AJU 02', 'Vita', '2026-08-01', '2026-12-20', 0],
          ['c4', 'aracaju', 'AJU 02', 'Diniz Fonseca', '2026-06-15', '2026-09-30', 0],
          ['c5', 'aracaju', 'AJU 03', 'Jardins Delicatessen', '2026-09-01', '2027-01-31', 0],
          ['c6', 'aracaju', 'AJU 03', 'Hospital dos Olhos', '2026-10-20', '2026-10-31', 0],
          ['c7', 'aracaju', 'AJU 04', 'São Braz', '2026-07-10', '2026-12-10', 0],
          ['c8', 'aracaju', 'AJU 04', 'Rede Primavera', '2026-10-27', '2026-11-14', 1],
        ],
      );
      ins(
        'INSERT OR IGNORE INTO programacoes (id,campanha_id,led_codigo,horario_inicio,duracao_segundos,dias_semana,insercoes_dia) VALUES (?,?,?,?,?,?,?)',
        [
          ['s1', 'c1', 'AJU 01', '07:00', 15, 'SEG', 1],
          ['s2', 'c3', 'AJU 01', '07:15', 15, 'SEG', 1],
          ['s3', 'c4', 'AJU 01', '07:30', 10, 'SEG', 1],
        ],
      );
      ins('INSERT OR IGNORE INTO usuarios (login,senha,perfil,nome) VALUES (?,?,?,?)', [
        ['admin', bcrypt.hashSync('admin123', 10), 'admin', 'Administrador'],
        ['regional', bcrypt.hashSync('reg123', 10), 'regional', 'Gestor Regional'],
        ['operador', bcrypt.hashSync('op123', 10), 'operador', 'Operador'],
        ['viewer', bcrypt.hashSync('view123', 10), 'visualizador', 'Visualizador'],
      ]);
      ins('INSERT OR IGNORE INTO usuario_cidade (login,cidade_id) VALUES (?,?)', [
        ['regional', 'aracaju'],
      ]);
      // Reserva exemplo
      ins(
        'INSERT OR IGNORE INTO reservas (id,campanha_id,inicio,fim,anunciante,criada_por) VALUES (?,?,?,?,?,?)',
        [['r1', 'c5', '2027-02-01', '2027-02-28', 'Jardins Delicatessen', 'admin']],
      );
    }
    // Admin de resgate
    if (sqliteDb.prepare('SELECT COUNT(*) v FROM usuarios').get().v === 0) {
      sqliteDb.prepare(
        "INSERT INTO usuarios (login,senha,perfil,nome) VALUES ('admin',?, 'admin','Administrador')",
      ).run(bcrypt.hashSync('admin123', 10));
      console.log('admin de resgate criado (admin/admin123 — troque a senha)');
    }
  }

  // Wrap síncrono → assíncrono para API uniforme
  function asyncify(fn) {
    return (...args) => Promise.resolve(fn(...args));
  }
  const prepare = (sql) => {
    const stmt = sqliteDb.prepare(sql);
    return {
      run: asyncify(stmt.run.bind(stmt)),
      get: asyncify(stmt.get.bind(stmt)),
      all: asyncify(stmt.all.bind(stmt)),
    };
  };
  const transaction = (fn) => {
    // Returns a function that executes the transaction when called
    return async () => {
      // Manual transaction for async support
      sqliteDb.exec('BEGIN');
      try {
        const txPrepare = (sql) => {
          const stmt = sqliteDb.prepare(sql);
          return {
            run: asyncify(stmt.run.bind(stmt)),
            get: asyncify(stmt.get.bind(stmt)),
            all: asyncify(stmt.all.bind(stmt)),
          };
        };
        await fn(txPrepare);
        sqliteDb.exec('COMMIT');
      } catch (e) {
        sqliteDb.exec('ROLLBACK');
        throw e;
      }
    };
  };
  async function getTableColumns(table) {
    return sqliteDb.prepare(`PRAGMA table_info(${table})`).all();
  }

  module.exports = {
    db: sqliteDb,
    query: (sql, params) => prepare(sql).all(...params),
    get: (sql, params) => prepare(sql).get(...params),
    run: (sql, params) => prepare(sql).run(...params),
    prepare,
    transaction,
    getTableColumns,
    isUsingPostgres: () => false,
    USING_POSTGRES: false,
  };
}

// Helpers de migração (usados pelo db.js no bootstrap)
async function runMigration(sqliteOnly = false) {
  if (sqliteOnly && USING_POSTGRES) return; // no PG, schema vem do supabase/schema.sql
  // As migrações de colunas são feitas no db.js (SQLite) ou via schema.sql (PG)
}
module.exports.runMigration = runMigration;