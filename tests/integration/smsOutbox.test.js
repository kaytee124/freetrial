const moolreService = require('../../services/moolreService');
const moolreConfig = require('../../config/moolre');
const { Customer, SmsOutbox } = require('../../models');
const {
  enqueueSms,
  processPendingSms,
  isPermanentPhoneError,
  senderIdForPurpose,
} = require('../../services/smsOutboxService');
const { uniquePhone } = require('../helpers/fixtures');

describe('SMS outbox', () => {
  let sendSmsSpy;

  afterEach(async () => {
    if (sendSmsSpy) sendSmsSpy.mockRestore();
    await SmsOutbox.destroy({ where: {} });
  });

  it('marks sent on success', async () => {
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, message: 'ok' });
    const result = await enqueueSms({
      recipient: uniquePhone(),
      message: 'hello',
      purpose: 'test',
      ref: 'test-ok',
    });
    expect(result.ok).toBe(true);
    expect(result.row.status).toBe('sent');
  });

  it('routes payment SMS to sender id 2 and notifications to main sender', async () => {
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, message: 'ok' });

    expect(senderIdForPurpose('payment_received')).toBe(moolreConfig.smsSenderId2);
    expect(senderIdForPurpose('payment_received_staff')).toBe(moolreConfig.smsSenderId2);
    expect(senderIdForPurpose('welcome')).toBe(moolreConfig.smsSenderId);
    expect(senderIdForPurpose('order_completed')).toBe(moolreConfig.smsSenderId);
    expect(senderIdForPurpose('staff_client_broadcast')).toBe(moolreConfig.smsSenderId);

    await enqueueSms({
      recipient: uniquePhone(),
      message: 'payment receipt',
      purpose: 'payment_received',
      ref: 'pay-sender-1',
    });
    expect(sendSmsSpy.mock.calls[0][0].senderId).toBe(moolreConfig.smsSenderId2);

    await enqueueSms({
      recipient: uniquePhone(),
      message: 'order ready',
      purpose: 'order_completed',
      ref: 'order-sender-1',
    });
    expect(sendSmsSpy.mock.calls[1][0].senderId).toBe(moolreConfig.smsSenderId);
  });

  it('leaves pending on transient failure and worker sends later', async () => {
    sendSmsSpy = jest
      .spyOn(moolreService, 'sendSms')
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ status: 1, message: 'ok' });

    const first = await enqueueSms({
      recipient: uniquePhone(),
      message: 'retry me',
      purpose: 'test',
    });
    expect(first.ok).toBe(false);
    expect(first.row.status).toBe('pending');

    const processed = await processPendingSms();
    expect(processed.sent).toBe(1);
    const row = await SmsOutbox.findByPk(first.row.id);
    expect(row.status).toBe('sent');
  });

  it('marks failed_permanent and sets phone_needs_correction for customers', async () => {
    const ctx = global.testContext;
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockRejectedValue(
      Object.assign(new Error('Invalid phone number'), { code: 'INVALID' })
    );

    const result = await enqueueSms({
      recipient: ctx.customer.phone_number,
      message: 'bad number',
      purpose: 'welcome',
      relatedType: 'customer',
      relatedId: ctx.customer.id,
    });
    expect(result.permanent).toBe(true);
    expect(result.row.status).toBe('failed_permanent');

    const customer = await Customer.findByPk(ctx.customer.id);
    expect(customer.phone_needs_correction).toBe(true);

    await customer.update({ phone_needs_correction: false });
  });

  it('classifies permanent phone errors', () => {
    expect(isPermanentPhoneError({ message: 'Phone number does not exist' })).toBe(true);
    expect(isPermanentPhoneError({ message: 'timeout' })).toBe(false);
  });

  it('cancels obsolete due/in_progress pending rows and does not send them', async () => {
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, message: 'ok' });

    const obsolete = await SmsOutbox.create({
      recipient: '233200000001',
      message: 'due soon',
      purpose: 'order_due_1h_staff',
      ref: 'obsolete-due-1',
      status: 'pending',
      attempts: 1,
      last_error: 'ref at (0) is not unique',
      created_at: new Date(),
    });
    const keep = await SmsOutbox.create({
      recipient: '233200000002',
      message: 'payment ok',
      purpose: 'payment_received_staff',
      ref: 'keep-pay-1',
      status: 'pending',
      attempts: 1,
      last_error: 'timeout',
      created_at: new Date(),
    });

    const processed = await processPendingSms();
    expect(processed.cancelledObsolete).toBeGreaterThanOrEqual(1);
    expect(processed.sent).toBe(1);

    const obsoleteRow = await SmsOutbox.findByPk(obsolete.id);
    expect(obsoleteRow.status).toBe('failed_permanent');
    expect(obsoleteRow.last_error).toBe('obsolete_purpose_disabled');

    const keepRow = await SmsOutbox.findByPk(keep.id);
    expect(keepRow.status).toBe('sent');

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy.mock.calls[0][0].message).toBe('payment ok');
    expect(sendSmsSpy.mock.calls[0][0].senderId).toBe(moolreConfig.smsSenderId2);
  });
});
