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
    res.status(500).json({ error: err.message });
  }
}

async function cancel(req, res) {
  try {
    const booking = await bookingService.cancelBooking(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err.message });
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

async function confirm(req, res) {
  try {
    const booking = await bookingService.confirmBooking(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) {
    const status = err.message === 'Forbidden' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
}

module.exports = { create, myBookings, cancel, businessBookings, confirm };
