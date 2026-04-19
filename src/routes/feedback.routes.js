const router = require('express').Router();
const { create } = require('../controllers/feedback.controller');

router.post('/', create);

module.exports = router;
