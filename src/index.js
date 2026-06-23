if (require.main === module) require('dotenv').config();

// Fail fast if critical secrets are missing
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { adminLimiter, registerLimiter, feedbackLimiter } = require('./middleware/rateLimiters');
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
const homeServiceController = require('./controllers/homeService.controller');

const app = express();

// Trust proxy only when deployed (Vercel sets x-forwarded-for)
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // 'same-origin' (helmet's default) breaks `window.closed`/postMessage
  // checks on OAuth popups (Google login). 'same-origin-allow-popups'
  // keeps the isolation benefits while letting popup windows communicate.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: false, // handled by client (Vite/Vercel)
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
}));

const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600,
}));

app.use(express.json({ limit: '50kb' }));

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authRoutes);
app.use('/api/businesses', generalLimiter, businessRoutes);
app.use('/api/pro/register', registerLimiter);
app.use('/api/pro', generalLimiter, proRoutes);
app.get('/api/professionals', generalLimiter, professionalController.findHomeProfessionals);
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
app.use('/api/feedback', feedbackLimiter, feedbackRoutes);

// Public home service endpoints
const { authenticate, requireRole } = require('./middleware/auth');
app.get('/api/professionals/:professionalId/home-services', generalLimiter, homeServiceController.publicListHomeServices);
app.post('/api/bookings/home', generalLimiter, authenticate, homeServiceController.createHomeBooking);
app.patch('/api/bookings/home/:id/cancel', generalLimiter, authenticate, homeServiceController.cancelHomeBooking);

app.use('/api/subscriptions', generalLimiter, require('./routes/subscription.routes'));
app.use('/api/payments', generalLimiter, require('./routes/payment.routes'));
app.use('/api/cron', require('./routes/cron.routes'));
app.use('/api/promotions', generalLimiter, require('./routes/promotion.routes'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Public platform stats
const prisma = require('./config/database');
app.get('/api/stats', generalLimiter, async (_req, res) => {
  try {
    const [businessCount, bookingCount, cityRows] = await Promise.all([
      prisma.business.count(),
      prisma.booking.count(),
      prisma.business.findMany({ select: { city: true }, distinct: ['city'], where: { city: { not: '' } } }),
    ]);
    res.json({ businesses: businessCount, cities: cityRows.length, bookings: bookingCount });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const SUPPORTED_COUNTRIES = ['CO', 'US'];
app.get('/api/geo/country', generalLimiter, async (req, res) => {
  // 1. CDN headers (Vercel / Cloudflare inject these in production)
  const vercel = req.headers['x-vercel-ip-country'];
  const cf     = req.headers['cf-ipcountry'];
  if (vercel && SUPPORTED_COUNTRIES.includes(vercel)) return res.json({ country: vercel, method: 'vercel' });
  if (cf     && SUPPORTED_COUNTRIES.includes(cf))     return res.json({ country: cf,     method: 'cloudflare' });

  // 2. IP geolocation via ipapi.co (free, no API key, ~30k req/month)
  const raw = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const isLocal = !raw || raw === '127.0.0.1' || raw === '::1' || raw.startsWith('192.168.') || raw.startsWith('10.') || raw.startsWith('172.');
  if (!isLocal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const geoRes = await fetch(`https://ipapi.co/${raw}/json/`, { signal: ctrl.signal });
      const geo = await geoRes.json();
      if (SUPPORTED_COUNTRIES.includes(geo.country_code)) {
        clearTimeout(timer);
        return res.json({ country: geo.country_code, method: 'ipapi' });
      }
    } catch { /* timeout or network error → fallback */ }
    finally { clearTimeout(timer); }
  }

  // 3. Default fallback
  res.json({ country: 'CO', method: 'fallback' });
});

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
