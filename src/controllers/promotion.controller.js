const prisma = require('../config/database');

const VALID_TYPES = ['PERCENTAGE', 'FIXED', 'CUSTOM_PRICE'];

// Prisma devuelve discountValue/customPrice como Decimal (se serializa a string
// en JSON). El cliente necesita number|null para reeditar sin "perder" el valor.
// Misma forma canónica que getPromotedBusinesses.
const serializePromo = (p) => ({
  ...p,
  discountValue: p.discountValue != null ? Number(p.discountValue) : null,
  customPrice:   p.customPrice   != null ? Number(p.customPrice)   : null,
});

async function getMyPromotions(req, res) {
  try {
    const business = await prisma.business.findFirst({ where: { ownerId: req.user.id } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    const promotions = await prisma.promotion.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(promotions.map(serializePromo));
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
        // Coherencia por tipo: CUSTOM_PRICE no lleva discountValue y viceversa.
        discountValue: safeType === 'CUSTOM_PRICE' ? null : numValue,
        customPrice:   safeType === 'CUSTOM_PRICE' ? numCustom : null,
        serviceIds:    Array.isArray(serviceIds) ? serviceIds : [],
        startDate:     new Date(startDate),
        endDate:       new Date(endDate),
        isActive:      isActive !== false,
        message:       message?.trim() || null,
      },
    });
    res.status(201).json(serializePromo(promotion));
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

    // endDate debe ser posterior a startDate. Se valida contra los valores
    // entrantes y, para los no provistos, contra los ya guardados en la promo.
    if (startDate !== undefined || endDate !== undefined) {
      const effStart = startDate !== undefined ? new Date(startDate) : promo.startDate;
      const effEnd   = endDate   !== undefined ? new Date(endDate)   : promo.endDate;
      if (effStart >= effEnd) return res.status(400).json({ error: 'La fecha de fin debe ser posterior a la de inicio' });
    }

    // Tipo y valores EFECTIVOS: lo que trae el body si viene, si no lo persistido.
    const effType = discountType !== undefined && VALID_TYPES.includes(discountType)
      ? discountType
      : promo.discountType;
    const effValue = discountValue !== undefined
      ? (discountValue != null ? parseFloat(discountValue) : null)
      : (promo.discountValue != null ? Number(promo.discountValue) : null);
    const effCustom = customPrice !== undefined
      ? (customPrice != null ? parseFloat(customPrice) : null)
      : (promo.customPrice != null ? Number(promo.customPrice) : null);

    // Revalidar igual que createPromotion: evita porcentaje>100 (pricing.js lo
    // clamparía a servicio gratis) o montos/precios no positivos.
    if (effType === 'PERCENTAGE') {
      if (effValue == null || isNaN(effValue) || effValue <= 0 || effValue > 100) {
        return res.status(400).json({ error: 'El porcentaje debe ser mayor que 0 y como máximo 100' });
      }
    } else if (effType === 'FIXED') {
      if (effValue == null || isNaN(effValue) || effValue <= 0) {
        return res.status(400).json({ error: 'El monto de descuento debe ser mayor que 0' });
      }
    } else if (effType === 'CUSTOM_PRICE') {
      if (effCustom == null || isNaN(effCustom) || effCustom <= 0) {
        return res.status(400).json({ error: 'El precio especial debe ser mayor que 0' });
      }
    }

    const updated = await prisma.promotion.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined       && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        // Se escribe SIEMPRE el trío tipo/valor/precio de forma coherente para no
        // dejar poblado el campo stale del tipo anterior (p.ej. customPrice viejo
        // al pasar a PERCENTAGE). CUSTOM_PRICE => discountValue:null y viceversa.
        discountType:  effType,
        discountValue: effType === 'CUSTOM_PRICE' ? null : effValue,
        customPrice:   effType === 'CUSTOM_PRICE' ? effCustom : null,
        ...(serviceIds !== undefined   && { serviceIds: Array.isArray(serviceIds) ? serviceIds : [] }),
        ...(startDate !== undefined    && { startDate: new Date(startDate) }),
        ...(endDate !== undefined      && { endDate: new Date(endDate) }),
        ...(isActive !== undefined     && { isActive: Boolean(isActive) }),
        ...(message !== undefined      && { message: message?.trim() || null }),
      },
    });
    res.json(serializePromo(updated));
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
    res.json(promotions.map(serializePromo));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Public endpoint: businesses that currently have at least one active,
// in-date promotion. Used for the hero/discovery carousel. Returns minimal
// card data plus a summary of the most-recent active promotion.
async function getPromotedBusinesses(req, res) {
  try {
    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate:   { gte: now },
        business:  { is: { status: 'ACTIVE' } },
      },
      orderBy: { startDate: 'desc' },
      include: {
        business: {
          select: {
            id: true, name: true, city: true, category: true,
            logoUrl: true, coverUrl: true, accentColor: true, status: true,
          },
        },
      },
    });

    // One card per business, keeping the first (most-recent) active promo.
    const seen = new Map();
    for (const promo of promotions) {
      const biz = promo.business;
      if (!biz || biz.status !== 'ACTIVE' || seen.has(biz.id)) continue;
      seen.set(biz.id, {
        id: biz.id,
        name: biz.name,
        city: biz.city,
        category: biz.category,
        logoUrl: biz.logoUrl,
        coverUrl: biz.coverUrl,
        accentColor: biz.accentColor,
        promotion: {
          id: promo.id,
          title: promo.title,
          discountType: promo.discountType,
          discountValue: promo.discountValue != null ? Number(promo.discountValue) : null,
          customPrice: promo.customPrice != null ? Number(promo.customPrice) : null,
        },
      });
    }

    res.json([...seen.values()]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { getMyPromotions, createPromotion, updatePromotion, deletePromotion, getPublicPromotions, getPromotedBusinesses };
