const scheduleService = require('../services/schedule.service');

// 'Forbidden' viene del guard de pertenencia del servicio (IDOR): el
// profesional no es de un negocio del caller.
function errStatus(err) { return err.message === 'Forbidden' ? 403 : 400; }

async function setSchedule(req, res) {
  try {
    const schedule = await scheduleService.setSchedule(req.user.id, req.params.professionalId, req.body);
    res.status(200).json(schedule);
  } catch (err) {
    res.status(errStatus(err)).json({ error: err.message });
  }
}

async function getSchedules(req, res) {
  try {
    const schedules = await scheduleService.getSchedules(req.params.professionalId);
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function deleteSchedule(req, res) {
  try {
    await scheduleService.deleteSchedule(req.user.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(errStatus(err)).json({ error: err.message });
  }
}

async function createException(req, res) {
  try {
    const exception = await scheduleService.createException(req.user.id, req.params.professionalId, req.body);
    res.status(201).json(exception);
  } catch (err) {
    res.status(errStatus(err)).json({ error: err.message });
  }
}

async function getExceptions(req, res) {
  try {
    const exceptions = await scheduleService.getExceptions(req.params.professionalId);
    res.json(exceptions);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function deleteException(req, res) {
  try {
    await scheduleService.deleteException(req.user.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(errStatus(err)).json({ error: err.message });
  }
}

module.exports = { setSchedule, getSchedules, deleteSchedule, createException, getExceptions, deleteException };
