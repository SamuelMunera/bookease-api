const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.patch('/change-password', authenticate, authController.changePassword);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;
