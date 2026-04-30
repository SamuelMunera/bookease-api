const prisma = require('../config/database');
const { uploadFile } = require('../config/storage');
const upload = require('../middleware/upload');

// ─── GALLERY ─────────────────────────────────────────────────────────────────

async function getGallery(req, res) {
  try {
    const { id } = req.params;
    const items = await prisma.businessGallery.findMany({
      where: { businessId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyGallery(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const items = await prisma.businessGallery.findMany({
      where: { businessId: biz.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(items);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function uploadGalleryPhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const count = await prisma.businessGallery.count({ where: { businessId: biz.id } });
    if (count >= 20) return res.status(400).json({ error: 'Máximo 20 fotos en la galería' });
    const ext = upload.safeExt(req.file.mimetype);
    const path = `businesses/${biz.id}/gallery/${Date.now()}.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const item = await prisma.businessGallery.create({
      data: { businessId: biz.id, url, caption: req.body.caption || null, sortOrder: count },
    });
    res.status(201).json(item);
  } catch (err) {
    console.error('[uploadGalleryPhoto]', err?.message || err);
    res.status(500).json({ error: err?.message?.includes('Storage not configured') ? 'Storage no configurado: agrega SUPABASE_SERVICE_KEY al .env' : 'Internal server error' });
  }
}

async function updateGalleryPhoto(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const item = await prisma.businessGallery.findUnique({ where: { id: req.params.photoId } });
    if (!item || item.businessId !== biz.id) return res.status(404).json({ error: 'Foto no encontrada' });
    const updated = await prisma.businessGallery.update({
      where: { id: item.id },
      data: { caption: req.body.caption ?? item.caption },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteGalleryPhoto(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const item = await prisma.businessGallery.findUnique({ where: { id: req.params.photoId } });
    if (!item || item.businessId !== biz.id) return res.status(404).json({ error: 'Foto no encontrada' });
    await prisma.businessGallery.delete({ where: { id: item.id } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── COVER ───────────────────────────────────────────────────────────────────

async function uploadCover(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    const ext = upload.safeExt(req.file.mimetype);
    const path = `businesses/${req.user.id}/cover.${ext}`;
    const url = await uploadFile(req.file.buffer, req.file.mimetype, path);
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const updated = await prisma.business.update({ where: { id: biz.id }, data: { coverUrl: url } });
    res.json({ url, coverUrl: updated.coverUrl });
  } catch (err) {
    console.error('[uploadCover]', err?.message || err);
    res.status(500).json({ error: err?.message?.includes('Storage not configured') ? 'Storage no configurado: agrega SUPABASE_SERVICE_KEY al .env' : 'Internal server error' });
  }
}

// ─── CUSTOMIZATION (accent color) ────────────────────────────────────────────

async function updateCustomization(req, res) {
  try {
    const { accentColor } = req.body;
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    // Basic hex color validation
    if (accentColor && !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(accentColor)) {
      return res.status(400).json({ error: 'Color inválido' });
    }
    const updated = await prisma.business.update({
      where: { id: biz.id },
      data: { accentColor: accentColor || null },
    });
    res.json({ accentColor: updated.accentColor });
  } catch (err) {
    console.error('[updateCustomization]', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── SERVICE CATEGORIES ──────────────────────────────────────────────────────

async function getServiceCategories(req, res) {
  try {
    const bizId = req.params.id;
    const cats = await prisma.serviceCategory.findMany({
      where: { businessId: bizId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        services: {
          select: { id: true, name: true, duration: true, price: true, description: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    res.json(cats);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyServiceCategories(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const cats = await prisma.serviceCategory.findMany({
      where: { businessId: biz.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        services: {
          select: { id: true, name: true, duration: true, price: true, description: true },
        },
      },
    });
    res.json(cats);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createServiceCategory(req, res) {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const count = await prisma.serviceCategory.count({ where: { businessId: biz.id } });
    const cat = await prisma.serviceCategory.create({
      data: { businessId: biz.id, name: name.trim(), sortOrder: count },
    });
    res.status(201).json(cat);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateServiceCategory(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const cat = await prisma.serviceCategory.findUnique({ where: { id: req.params.catId } });
    if (!cat || cat.businessId !== biz.id) return res.status(404).json({ error: 'Categoría no encontrada' });
    const data = {};
    if (req.body.name?.trim()) data.name = req.body.name.trim();
    if (req.body.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder);
    const updated = await prisma.serviceCategory.update({ where: { id: cat.id }, data });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deleteServiceCategory(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const cat = await prisma.serviceCategory.findUnique({ where: { id: req.params.catId } });
    if (!cat || cat.businessId !== biz.id) return res.status(404).json({ error: 'Categoría no encontrada' });
    // Unlink services from this category before deleting
    await prisma.service.updateMany({ where: { categoryId: cat.id }, data: { categoryId: null } });
    await prisma.serviceCategory.delete({ where: { id: cat.id } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── BUSINESS HOURS ──────────────────────────────────────────────────────────

async function getHours(req, res) {
  try {
    const hours = await prisma.businessHours.findMany({
      where: { businessId: req.params.id },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json(hours);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyHours(req, res) {
  try {
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    const hours = await prisma.businessHours.findMany({
      where: { businessId: biz.id },
      orderBy: { dayOfWeek: 'asc' },
    });
    res.json(hours);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function setMyHours(req, res) {
  try {
    const { hours } = req.body; // array of { dayOfWeek, openTime, closeTime, isOpen }
    if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours debe ser un arreglo' });
    const biz = await prisma.business.findFirst({ where: { ownerId: req.user.id }, select: { id: true } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const h of hours) {
      if (h.dayOfWeek < 0 || h.dayOfWeek > 6) return res.status(400).json({ error: 'dayOfWeek inválido' });
      if (h.isOpen && (!TIME_RE.test(h.openTime) || !TIME_RE.test(h.closeTime))) {
        return res.status(400).json({ error: 'Formato de hora inválido (HH:MM)' });
      }
    }

    const results = await Promise.all(
      hours.map((h) =>
        prisma.businessHours.upsert({
          where: { businessId_dayOfWeek: { businessId: biz.id, dayOfWeek: h.dayOfWeek } },
          create: {
            businessId: biz.id,
            dayOfWeek: h.dayOfWeek,
            openTime: h.isOpen ? h.openTime : '09:00',
            closeTime: h.isOpen ? h.closeTime : '18:00',
            isOpen: h.isOpen ?? true,
          },
          update: {
            openTime: h.isOpen ? h.openTime : '09:00',
            closeTime: h.isOpen ? h.closeTime : '18:00',
            isOpen: h.isOpen ?? true,
          },
        })
      )
    );
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getGallery, getMyGallery, uploadGalleryPhoto, updateGalleryPhoto, deleteGalleryPhoto,
  uploadCover, updateCustomization,
  getServiceCategories, getMyServiceCategories, createServiceCategory, updateServiceCategory, deleteServiceCategory,
  getHours, getMyHours, setMyHours,
};
