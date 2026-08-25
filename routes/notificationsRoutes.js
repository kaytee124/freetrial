const express = require('express');
const notificationsController = require('../controllers/notificationsController');
const { authenticate } = require('../middleware/auth');
const { isAdminOrSuperadmin } = require('../middleware/permissions');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get(
  '/pickups/preview/',
  authenticate,
  isAdminOrSuperadmin,
  asyncHandler(notificationsController.preview)
);
router.get(
  '/pickups/',
  authenticate,
  isAdminOrSuperadmin,
  asyncHandler(notificationsController.list)
);
router.post(
  '/sms/clients/',
  authenticate,
  isAdminOrSuperadmin,
  asyncHandler(notificationsController.broadcastSms)
);

module.exports = router;
