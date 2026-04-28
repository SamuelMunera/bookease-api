const bookingService = require('../services/booking.service');

async function create(req, res) {
  try {
    const { professionalId, serviceId, date, startTime } = req.body;
    if (!professionalId || !serviceId || !date || !startTime) {
      return res.status(400).json({ error: 'professionalId, serviceId, date and startTime are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime)) {
      return res.status(400).json({ error: 'startTime must be HH:MM' });
    }

    const booking = await bookingService.createBooking({
      clientId: req.user.id,
      professionalId,
      serviceId,
      date,
      startTime,
    });
    res.status(201).json(booking);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function myBookings(req, res) {
  try {
    const bookings = await bookingService.getUserBookings(req.user.id);
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

async function cancel(req, res) {
  try {
    const booking = await bookingService.cancelBooking(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : (err.status || 400);
    res.status(status).json({ error: err.message, code: err.code });
  }
}

async function businessBookings(req, res) {
  try {
    const bookings = await bookingService.getBusinessBookings(
      req.params.id,
      req.user.id,
      req.query
    );
    res.json(bookings);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function cancelAsOwner(req, res) {
  try {
    const booking = await bookingService.cancelBookingAsOwner(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function confirm(req, res) {
  try {
    const booking = await bookingService.confirmBooking(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function reschedule(req, res) {
  try {
    const { date, startTime } = req.body;
    if (!date || !startTime) {
      return res.status(400).json({ error: 'date and startTime are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime)) {
      return res.status(400).json({ error: 'startTime must be HH:MM' });
    }
    const booking = await bookingService.rescheduleBooking(req.params.id, req.user.id, { date, startTime });
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : (err.status || 400);
    res.status(status).json({ error: err.message, code: err.code });
  }
}

async function manualCreate(req, res) {
  try {
    const { professionalId, serviceId, date, startTime, clientEmail, clientName, clientPhone, source } = req.body;
    const booking = await bookingService.createManualBooking({
      creatorId: req.user.id, creatorRole: req.user.role,
      professionalId, serviceId, date, startTime,
      clientEmail, clientName, clientPhone, source,
    });
    res.status(201).json(booking);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function noShow(req, res) {
  try {
    const booking = await bookingService.markNoShow(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function complete(req, res) {
  try {
    const booking = await bookingService.markComplete(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { create, myBookings, cancel, cancelAsOwner, businessBookings, confirm, reschedule, manualCreate, noShow, complete };
