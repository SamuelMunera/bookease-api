if (require.main === module) require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { adminLimiter } = require('./middleware/rateLimiters');
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
const reviewRoutes    = require('./routes/review.routes');
const feedbackRoutes  = require('./routes/feedback.routes');

const app = express();

// Trust proxy only when deployed (Vercel sets x-forwarded-for)
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // handled by client (Vite/Vercel)
}));

const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50kb' }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/businesses', generalLimiter, businessRoutes);
app.use('/api/pro/register', authLimiter);
app.use('/api/pro', generalLimiter, proRoutes);
app.get('/api/professionals/:id', generalLimiter, professionalController.findById);
app.get('/api/professionals/:id/services', generalLimiter, professionalController.getProfessionalServices);
app.use('/api/businesses/:businessId/professionals', generalLimiter, professionalRoutes);
app.use('/api/businesses/:businessId/services', generalLimiter, serviceRoutes);
app.use('/api/businesses/:businessId/professionals/:professionalId/schedules', generalLimiter, scheduleRoutes);
app.use('/api/slots', generalLimiter, slotRoutes);
app.use('/api/bookings', generalLimiter, bookingRoutes);
app.use('/api/categories', generalLimiter, categoryRoutes);
app.use('/api/admin', adminLimiter, require('./routes/admin.routes'));
app.use('/api', generalLimiter, reviewRoutes);
app.use('/api/feedback', generalLimiter, feedbackRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Catch-all 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — never leak stack traces
app.use((err, _req, res, _next) => {
  console.error(err.message || err);
  if (err.code === 'LIMIT_FILE_SIZE' || err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload demasiado grande' });
  }
  if (err.message && err.message.startsWith('Solo se permiten')) return res.status(400).json({ error: err.message });
  const status = err.status || err.statusCode || 500;
  res.status(status < 400 || status > 599 ? 500 : status).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
