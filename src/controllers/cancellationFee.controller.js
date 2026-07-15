const cancellationFeeService = require('../services/cancellationFee.service');

async function listMyDebts(req, res) {
  try {
    const data = await cancellationFeeService.listMyDebts(req.user.id, { status: req.query.status });
    res.json(data);
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
}

async function updateDebtStatus(req, res) {
  try {
    const fee = await cancellationFeeService.updateDebtStatus(req.user.id, req.params.id, req.body?.status);
    res.json(fee);
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
}

module.exports = { listMyDebts, updateDebtStatus };
