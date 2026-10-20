const { requireEnv, requireEnvInt } = require('./env');

function poolConfig() {
  return {
    max: requireEnvInt('DB_POOL_MAX'),
    min: 0,
    acquire: 30000,
    idle: 10000,
  };
}

/**
 * TLS is required by TiDB Cloud Serverless public endpoints (and recommended
 * for any remote MySQL). Enabled when DB_SSL=true or the host is a TiDB Cloud
 * gateway. Node.js trusts the public CA, so no certificate file is needed.
 */
function sslEnabled() {
  if (process.env.DB_SSL !== undefined && process.env.DB_SSL !== '') {
    return process.env.DB_SSL === 'true';
  }
  return /\.tidbcloud\.com$/i.test(requireEnv('DB_HOST'));
}

function dialectOptions() {
  const options = { charset: 'utf8mb4' };
  if (sslEnabled()) {
    options.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  }
  return options;
}

const sharedDialect = {
  dialect: 'mysql',
  dialectOptions: dialectOptions(),
  logging: false,
};

const sharedDefine = {
  underscored: false,
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const dbCredentials = {
  username: requireEnv('DB_USER'),
  password: requireEnv('DB_PASSWORD'),
  host: requireEnv('DB_HOST'),
  port: requireEnvInt('DB_PORT'),
};

module.exports = {
  development: {
    ...dbCredentials,
    database: requireEnv('DB_NAME'),
    ...sharedDialect,
    define: sharedDefine,
    pool: poolConfig(),
  },
  test: {
    ...dbCredentials,
    database: requireEnv('DB_NAME_TEST'),
    dialect: 'mysql',
    dialectOptions: dialectOptions(),
    logging: false,
  },
  production: {
    ...dbCredentials,
    database: requireEnv('DB_NAME'),
    ...sharedDialect,
    pool: poolConfig(),
  },
  benchmark: {
    ...dbCredentials,
    database: requireEnv('DB_NAME_BENCHMARK'),
    ...sharedDialect,
    define: sharedDefine,
    pool: poolConfig(),
  },
};
