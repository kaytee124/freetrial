const pickupNotificationService = require('../services/pickupNotificationService');
const staffBroadcastSmsService = require('../services/staffBroadcastSmsService');

async function preview(req, res) {
  const data = await pickupNotificationService.previewPickupNotifications();
  res.json({ status: 'success', data });
}

async function list(req, res) {
  const data = await pickupNotificationService.paginatedPickupNotifications(req.query);
  res.json({ status: 'success', data });
}

async function broadcastSms(req, res) {
  const data = await staffBroadcastSmsService.broadcastToClients(req.body, req.user);
  res.json({ status: 'success', message: 'Broadcast SMS queued', data });
}

module.exports = { preview, list, broadcastSms };
