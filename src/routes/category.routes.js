const router = require('express').Router();
const prisma  = require('../config/database');

router.get('/', async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
