// Adaptador PostgreSQL/Supabase para o backend SaaS LEDs.
// Usa pg (node-postgres) de forma assíncrona.
// Espelha a API síncrona do better-sqlite3, mas todas as chamadas são async.
//
// Uso: em src/index.js, substitua `const db = require('./db')` por
// `const db = require('./db.adapter')`. Todas as rotas devem ser async
// e usar await nas chamadas a db.prepare(...).run()/get()/all().

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}
async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}
async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return res;
}
function prepare(sql) {
  return {
    async run(...p) {
      return pool.query(sql, p);
    },
    async get(...p) {
      const r = await pool.query(sql, p);
      return r.rows[0] || null;
    },
    async all(...p) {
      const r = await pool.query(sql, p);
      return r.rows;
    },
  };
}
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      prepare: (s) => ({
        async run(...p) {
          return await client.query(s, p);
        },
        async get(...p) {
          const r = await client.query(s, p);
          return r.rows[0] || null;
        },
        async all(...p) {
          const r = await client.query(s, p);
          return r.rows;
        },
      }),
    });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const db = {
  pool,
  query,
  get,
  run,
  prepare,
  transaction,
  isUsingPostgres: () => true,
  USING_POSTGRES: true,
};

module.exports = db;
