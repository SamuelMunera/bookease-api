const router = require('express').Router();
const slotController = require('../controllers/slot.controller');

router.get('/', slotController.getAvailableSlots);

module.exports = router;
