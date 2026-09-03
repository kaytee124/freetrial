const axios = require('axios');
const moolreConfig = require('../config/moolre');

const MOOLRE_HEADERS = {
  'X-API-USER': moolreConfig.apiUser,
  'X-API-PUBKEY': moolreConfig.apiPubkey,
  'Content-Type': 'application/json',
};

async function generatePaymentLink({ email, amount, externalref, metadata }) {
  const payload = {
    type: 1,
    amount: String(amount),
    currency: 'GHS',
    accountnumber: moolreConfig.accountNumber,
    email,
    externalref,
    callback: moolreConfig.webhookUrl,
    reusable: '0',
    metadata: metadata || {},
  };

  if (moolreConfig.redirectUrl) {
    payload.redirect = moolreConfig.redirectUrl;
  }

  const response = await axios.post(moolreConfig.urls.embedLink, payload, {
    headers: MOOLRE_HEADERS,
    timeout: 30000,
  });
  return response.data;
}

async function checkTransactionStatus({ idtype, id }) {
  const response = await axios.post(
    moolreConfig.urls.transactStatus,
    {
      type: 1,
      idtype: String(idtype),
      id,
      accountnumber: moolreConfig.accountNumber,
    },
    { headers: MOOLRE_HEADERS, timeout: 30000 }
  );
  return response.data;
}

async function initiatePayment({
  channel,
  payer,
  amount,
  externalref,
  sessionid,
  reference,
}) {
  const payload = {
    type: 1,
    channel: String(channel),
    currency: 'GHS',
    payer,
    amount: String(amount),
    externalref,
    sessionid: sessionid || '',
    reference: reference || '',
    accountnumber: moolreConfig.accountNumber,
  };

  const response = await axios.post(moolreConfig.urls.transactPayment, payload, {
    headers: MOOLRE_HEADERS,
    timeout: 30000,
  });

  const data = response.data;
  if (Number(data.status) !== 1) {
    const err = new Error(data.message || 'Moolre payment initiation failed');
    err.code = data.code;
    err.response = data;
    throw err;
  }
  return data;
}

async function sendSms({ recipient, message, ref, senderId }) {
  const payload = {
    type: 1,
    senderid: senderId || moolreConfig.smsSenderId,
    messages: [
      {
        recipient,
        message,
        ...(ref ? { ref } : {}),
      },
    ],
  };

  const response = await axios.post(moolreConfig.urls.smsSend, payload, {
    headers: {
      'X-API-VASKEY': moolreConfig.smsVasKey,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const data = response.data;
  if (Number(data.status) !== 1) {
    const err = new Error(data.message || 'Moolre SMS send failed');
    err.code = data.code;
    err.response = data;
    throw err;
  }
  return data;
}

module.exports = {
  generatePaymentLink,
  checkTransactionStatus,
  initiatePayment,
  sendSms,
};
