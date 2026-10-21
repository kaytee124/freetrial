/**
 * Create admin accounts vera and edem with credential SMS.
 * Usage: node scripts/createVeraEdemAdmins.js
 */
require('dotenv').config();

const { User, SmsOutbox, sequelize } = require('../models');
const { createAdmin } = require('../services/userService');
const { formatSmsRecipient } = require('../utils/phone');

const ADMINS = [
  { username: 'vera', first_name: 'Yeboah', last_name: '', phone_number: '0537187136' },
  { username: 'edem', first_name: 'kwabena', last_name: '', phone_number: '0545896147' },
];

async function main() {
  await sequelize.authenticate();
  const results = [];

  for (const data of ADMINS) {
    const existing = await User.findOne({ where: { username: data.username } });
    if (existing) {
      results.push({
        username: data.username,
        status: 'skipped',
        reason: 'USERNAME_EXISTS',
        user_id: existing.id,
        role: existing.role,
      });
      continue;
    }

    const user = await createAdmin(data);
    results.push({
      username: user.username,
      status: 'created',
      user_id: user.id,
      role: user.role,
      phone: user.phone_number,
      password_formula: 'Trenor@{username}',
    });
  }

  await new Promise((r) => setTimeout(r, 3000));

  const recipients = ADMINS.map((a) => formatSmsRecipient(a.phone_number));
  const smsRows = await SmsOutbox.findAll({
    where: { purpose: 'staff_credentials' },
    order: [['id', 'DESC']],
    limit: 10,
    attributes: ['id', 'recipient', 'status', 'purpose', 'related_id', 'attempts', 'last_error'],
  });

  const relevantSms = smsRows
    .map((r) => r.toJSON())
    .filter((r) => recipients.includes(r.recipient));

  console.log(
    JSON.stringify(
      {
        event: 'create_vera_edem_admins_done',
        results,
        sms_outbox: relevantSms,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
