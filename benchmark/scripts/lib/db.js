require('dotenv').config({ path: require('./paths').ROOT + '/.env' });

const mysql = require('mysql2/promise');
const { ROOT } = require('./paths');

function sslEnabled() {
  if (process.env.DB_SSL !== undefined && process.env.DB_SSL !== '') {
    return process.env.DB_SSL === 'true';
  }
  return /\.tidbcloud\.com$/i.test(process.env.DB_HOST || '');
}

function getDbConfig(overrides = {}) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ssl: sslEnabled() ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    database:
      overrides.database ||
      process.env.DB_NAME_BENCHMARK ||
      'laundry_management_system_benchmark',
    multipleStatements: overrides.multipleStatements || false,
    ...overrides,
  };
}

async function createConnection(overrides = {}) {
  return mysql.createConnection(getDbConfig(overrides));
}

async function createPool(overrides = {}) {
  return mysql.createPool({
    ...getDbConfig(overrides),
    waitForConnections: true,
    connectionLimit: 10,
  });
}

async function createServerConnection() {
  const { database, ...base } = getDbConfig();
  return mysql.createConnection(base);
}

async function ensureBenchmarkDatabase() {
  const dbName = process.env.DB_NAME_BENCHMARK || 'laundry_management_system_benchmark';
  const conn = await createServerConnection();
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  return dbName;
}

function runMigrateBenchmark() {
  const { spawnSync } = require('child_process');
  const env = {
    ...process.env,
    NODE_ENV: 'benchmark',
    DB_NAME: process.env.DB_NAME_BENCHMARK || 'laundry_management_system_benchmark',
  };
  const result = spawnSync('npx', ['sequelize-cli', 'db:migrate'], {
    cwd: ROOT,
    env,
    shell: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Benchmark migration failed');
  }
}

module.exports = {
  getDbConfig,
  createConnection,
  createPool,
  createServerConnection,
  ensureBenchmarkDatabase,
  runMigrateBenchmark,
};
