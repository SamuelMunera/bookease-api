if (require.main === module) require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const businessRoutes = require('./routes/business.routes');
const professionalRoutes = require('./routes/professional.routes');
const proRoutes = require('./routes/pro.routes');
const professionalController = require('./controllers/professional.controller');
const serviceRoutes = require('./routes/service.routes');
const scheduleRoutes = require('./routes/schedule.routes');
const slotRoutes = require('./routes/slot.routes');
const bookingRoutes   = require('./routes/booking.routes');
const categoryRoutes  = require('./routes/category.routes');

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/pro', proRoutes);
app.get('/api/professionals/:id', professionalController.findById);
app.get('/api/professionals/:id/services', professionalController.getProfessionalServices);
app.use('/api/businesses/:businessId/professionals', professionalRoutes);
app.use('/api/businesses/:businessId/services', serviceRoutes);
app.use('/api/businesses/:businessId/professionals/:professionalId/schedules', scheduleRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/admin', require('./routes/admin.routes'));

app.get('/health', (_, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
