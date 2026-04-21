const multer = require('multer');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAFE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPEG, PNG, GIF o WebP'));
    }
    cb(null, true);
  },
});

upload.safeExt = (mimetype) => SAFE_EXT[mimetype] || 'jpg';

module.exports = upload;
