const router = require('express').Router({ mergeParams: true });
const serviceController = require('../controllers/service.controller');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', serviceController.findByBusiness);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), serviceController.create);
router.put('/:id', authenticate, requireRole('BUSINESS_OWNER'), serviceController.update);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), serviceController.remove);

module.exports = router;
