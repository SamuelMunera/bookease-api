const router = require('express').Router();
const slotController = require('../controllers/slot.controller');

router.get('/', slotController.getAvailableSlots);
router.get('/home', slotController.getHomeSlots);

module.exports = router;
