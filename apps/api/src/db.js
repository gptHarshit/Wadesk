import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected idle Postgres client error'));

const camel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Convert snake_case column names to camelCase (top level only; JSON values are left as stored). */
function camelRow(row) {
  const out = {};
  for (const key of Object.keys(row)) out[camel(key)] = row[key];
  return out;
}

function wrap(executor) {
  const run = async (text, params = []) => {
    const res = await executor.query(text, params);
    return { rows: (res.rows ?? []).map(camelRow), rowCount: res.rowCount ?? 0 };
  };
  return {
    /** All rows. */
    many: async (text, params) => (await run(text, params)).rows,
    /** First row or null. */
    one: async (text, params) => (await run(text, params)).rows[0] ?? null,
    /** Number of affected rows. */
    exec: async (text, params) => (await run(text, params)).rowCount,
  };
}

export const db = {
  ...wrap(pool),

  /** Run `fn` inside a transaction. Rolls back if it throws. */
  async tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async ping() {
    await pool.query('SELECT 1');
  },

  async close() {
    await pool.end();
  },
};
