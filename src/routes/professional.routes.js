const router = require('express').Router({ mergeParams: true });
const professionalController = require('../controllers/professional.controller');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', professionalController.findByBusiness);
router.post('/', authenticate, requireRole('BUSINESS_OWNER'), professionalController.create);
router.put('/:id', authenticate, requireRole('BUSINESS_OWNER'), professionalController.update);
router.delete('/:id', authenticate, requireRole('BUSINESS_OWNER'), professionalController.remove);

module.exports = router;
