const { requireEnv } = require('./env');

function normalizePath(path) {
  const trimmed = String(path).trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function joinUrl(base, path) {
  return `${base.replace(/\/$/, '')}${normalizePath(path)}`;
}

const apiBase = requireEnv('MOOLRE_API_BASE').replace(/\/$/, '');
const paths = {
  embedLink: normalizePath(requireEnv('MOOLRE_PATH_EMBED_LINK')),
  transactStatus: normalizePath(requireEnv('MOOLRE_PATH_TRANSACT_STATUS')),
  transactPayment: normalizePath(requireEnv('MOOLRE_PATH_TRANSACT_PAYMENT')),
  smsSend: normalizePath(requireEnv('MOOLRE_PATH_SMS_SEND')),
};

module.exports = {
  apiUser: requireEnv('MOOLRE_API_USER'),
  apiPubkey: requireEnv('MOOLRE_API_PUBKEY'),
  accountNumber: requireEnv('MOOLRE_ACCOUNT_NUMBER'),
  webhookUrl: requireEnv('MOOLRE_WEBHOOK_URL'),
  redirectUrl: process.env.MOOLRE_REDIRECT_URL?.trim() || null,
  webhookSecret: requireEnv('MOOLRE_WEBHOOK_SECRET'),
  smsVasKey: requireEnv('MOOLRE_SMS_VAS_KEY'),
  smsSenderId: requireEnv('MOOLRE_SMS_SENDER_ID'),
  smsSenderId2: requireEnv('MOOLRE_SMS_SENDER_ID_2'),
  merchantEmail: requireEnv('MOOLRE_MERCHANT_EMAIL'),
  apiBase,
  paths,
  urls: {
    embedLink: joinUrl(apiBase, paths.embedLink),
    transactStatus: joinUrl(apiBase, paths.transactStatus),
    transactPayment: joinUrl(apiBase, paths.transactPayment),
    smsSend: joinUrl(apiBase, paths.smsSend),
  },
};
