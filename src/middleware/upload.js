const multer = require('multer');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAFE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// S-006: el mimetype declarado por el cliente (file.mimetype) proviene de un
// header falsificable. Como usamos memoryStorage el contenido real está en
// req.file.buffer, así que inspeccionamos los "magic bytes" iniciales para
// confirmar que el archivo es realmente una imagen del tipo permitido.
// Devuelve el mimetype detectado a partir del contenido, o null si no coincide
// con ningún tipo soportado.
function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // GIF: "GIF87a" / "GIF89a" (47 49 46 38 ...). No está en ALLOWED_MIME pero lo
  // detectamos explícitamente para poder rechazarlo con claridad.
  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF"...."WEBP" (52 49 46 46 __ __ __ __ 57 45 42 50)
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

// Middleware que corre DESPUÉS de multer: valida el contenido real del buffer.
// Si el archivo no coincide con un tipo de imagen permitido lo rechaza (400).
function validateMagicBytes(req, res, next) {
  if (!req.file || !req.file.buffer) return next();
  const detected = detectImageMime(req.file.buffer);
  if (!detected || !ALLOWED_MIME.has(detected)) {
    return res.status(400).json({ error: 'El contenido del archivo no es una imagen JPEG, PNG o WebP válida' });
  }
  // Alineamos el mimetype al tipo real detectado para que safeExt y el guardado
  // no dependan del header enviado por el cliente.
  req.file.mimetype = detected;
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    // Primer filtro barato por header (se ejecuta antes de recibir el buffer).
    // La validación fuerte por magic bytes ocurre en validateMagicBytes.
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPEG, PNG o WebP'));
    }
    cb(null, true);
  },
});

// Envolvemos upload.single para encadenar automáticamente la validación de
// magic bytes tras multer, sin tocar rutas ni controladores (Express aplana
// arrays de middleware).
const originalSingle = upload.single.bind(upload);
upload.single = (fieldName) => [originalSingle(fieldName), validateMagicBytes];

upload.safeExt = (mimetype) => SAFE_EXT[mimetype] || 'jpg';
upload.detectImageMime = detectImageMime;
upload.validateMagicBytes = validateMagicBytes;

module.exports = upload;
