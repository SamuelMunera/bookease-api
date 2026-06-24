const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimiters');

router.post('/register',         registerLimiter,        authController.register);
router.post('/login',            loginLimiter,           authController.login);
router.post('/switch-context',   authenticate,           authController.switchContext);
router.patch('/change-password', authenticate,           authController.changePassword);
router.post('/forgot-password',  forgotPasswordLimiter,  authController.forgotPassword);
router.post('/reset-password',   resetPasswordLimiter,   authController.resetPassword);
router.post('/google',           loginLimiter,           authController.googleAuth);
router.patch('/me',              authenticate,           authController.updateMe);

module.exports = router;
