const prisma = require('../config/database');

async function getMyPromotions(req, res) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    const promotions = await prisma.promotion.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(promotions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function createPromotion(req, res) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const { title, description, discountType, discountValue, customPrice, serviceIds, startDate, endDate, isActive, message } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'El título es obligatorio' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Fechas de inicio y fin son obligatorias' });
    if (new Date(startDate) >= new Date(endDate)) return res.status(400).json({ error: 'La fecha de fin debe ser posterior a la de inicio' });

    const VALID_TYPES = ['PERCENTAGE', 'FIXED', 'CUSTOM_PRICE'];
    const safeType = VALID_TYPES.includes(discountType) ? discountType : 'PERCENTAGE';

    // Validación por tipo de descuento.
    const numValue = discountValue != null ? parseFloat(discountValue) : null;
    const numCustom = customPrice != null ? parseFloat(customPrice) : null;
    if (safeType === 'PERCENTAGE') {
      if (numValue == null || isNaN(numValue) || numValue <= 0 || numValue > 100) {
        return res.status(400).json({ error: 'El porcentaje debe ser mayor que 0 y como máximo 100' });
      }
    } else if (safeType === 'FIXED') {
      if (numValue == null || isNaN(numValue) || numValue <= 0) {
        return res.status(400).json({ error: 'El monto de descuento debe ser mayor que 0' });
      }
    } else if (safeType === 'CUSTOM_PRICE') {
      if (numCustom == null || isNaN(numCustom) || numCustom <= 0) {
        return res.status(400).json({ error: 'El precio especial debe ser mayor que 0' });
      }
    }

    const promotion = await prisma.promotion.create({
      data: {
        businessId:    business.id,
        title:         title.trim(),
        description:   description?.trim() || null,
        discountType:  safeType,
        discountValue: discountValue != null ? parseFloat(discountValue) : null,
        customPrice:   customPrice != null ? parseFloat(customPrice) : null,
        serviceIds:    Array.isArray(serviceIds) ? serviceIds : [],
        startDate:     new Date(startDate),
        endDate:       new Date(endDate),
        isActive:      isActive !== false,
        message:       message?.trim() || null,
      },
    });
    res.status(201).json(promotion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function updatePromotion(req, res) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const promo = await prisma.promotion.findUnique({ where: { id: req.params.id } });
    if (!promo || promo.businessId !== business.id) return res.status(404).json({ error: 'Promoción no encontrada' });

    const { title, description, discountType, discountValue, customPrice, serviceIds, startDate, endDate, isActive, message } = req.body;

    const VALID_TYPES = ['PERCENTAGE', 'FIXED', 'CUSTOM_PRICE'];

    // endDate debe ser posterior a startDate. Se valida contra los valores
    // entrantes y, para los no provistos, contra los ya guardados en la promo.
    if (startDate !== undefined || endDate !== undefined) {
      const effStart = startDate !== undefined ? new Date(startDate) : promo.startDate;
      const effEnd   = endDate   !== undefined ? new Date(endDate)   : promo.endDate;
      if (effStart >= effEnd) return res.status(400).json({ error: 'La fecha de fin debe ser posterior a la de inicio' });
    }

    const updated = await prisma.promotion.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined       && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(discountType !== undefined && VALID_TYPES.includes(discountType) && { discountType }),
        ...(discountValue !== undefined && { discountValue: discountValue != null ? parseFloat(discountValue) : null }),
        ...(customPrice !== undefined  && { customPrice: customPrice != null ? parseFloat(customPrice) : null }),
        ...(serviceIds !== undefined   && { serviceIds: Array.isArray(serviceIds) ? serviceIds : [] }),
        ...(startDate !== undefined    && { startDate: new Date(startDate) }),
        ...(endDate !== undefined      && { endDate: new Date(endDate) }),
        ...(isActive !== undefined     && { isActive: Boolean(isActive) }),
        ...(message !== undefined      && { message: message?.trim() || null }),
      },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function deletePromotion(req, res) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    const promo = await prisma.promotion.findUnique({ where: { id: req.params.id } });
    if (!promo || promo.businessId !== business.id) return res.status(404).json({ error: 'Promoción no encontrada' });

    await prisma.promotion.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Public endpoint: active promotions for a business
async function getPublicPromotions(req, res) {
  try {
    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: {
        businessId: req.params.id,
        isActive: true,
        startDate: { lte: now },
        endDate:   { gte: now },
      },
      orderBy: { startDate: 'asc' },
    });
    res.json(promotions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getMyPromotions, createPromotion, updatePromotion, deletePromotion, getPublicPromotions };
