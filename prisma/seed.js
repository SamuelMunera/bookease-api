// prisma/seed.js — Bookease definitive demo seed
if (require.main === module) require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({ log: ['warn', 'error'] });
const PWD = bcrypt.hashSync('demo1234', 10);

// ─── utils ────────────────────────────────────────────────────────────────────
function norm(s) {
  if (!s) return null;
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
}

function activePeriod() {
  const start = new Date();
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  return { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end };
}

// dayOfWeek 0=Sun … 6=Sat. ranges = { 1: ['08:00','18:00'], ... }
function weekSchedule(ranges) {
  return Array.from({ length: 7 }, (_, d) => {
    const r = ranges[d];
    return r
      ? { dayOfWeek: d, startTime: r[0], endTime: r[1], isActive: true }
      : { dayOfWeek: d, startTime: '09:00', endTime: '18:00', isActive: false };
  });
}

function bizHours(ranges) {
  return Array.from({ length: 7 }, (_, d) => {
    const r = ranges[d];
    return r
      ? { dayOfWeek: d, openTime: r[0], closeTime: r[1], isOpen: true }
      : { dayOfWeek: d, openTime: '09:00', closeTime: '18:00', isOpen: false };
  });
}

// ─── image URLs ───────────────────────────────────────────────────────────────
const IMG = {
  elFilo_cover:  'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=1400&q=80',
  elFilo_logo:   'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=400&q=80',
  aqua_cover:    'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1400&q=80',
  aqua_logo:     'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?w=400&q=80',
  fade_cover:    'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=1400&q=80',
  fade_logo:     'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=400&q=80',
  bloom_cover:   'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1400&q=80',
  bloom_logo:    'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&q=80',
  man1:   'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80',
  man2:   'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80',
  man3:   'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80',
  man4:   'https://images.unsplash.com/photo-1463453091185-61582044d556?w=400&q=80',
  woman1: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80',
  woman2: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&q=80',
  woman3: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400&q=80',
  woman4: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80',
};

// ─── cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('🧹  Limpiando base de datos...');
  await prisma.booking.deleteMany();
  await prisma.review.deleteMany();
  await prisma.scheduleException.deleteMany();
  await prisma.scheduleOverride.deleteMany();
  await prisma.homeSchedule.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.professionalServiceConfig.deleteMany();
  await prisma.professionalPhoto.deleteMany();
  await prisma.joinRequest.deleteMany();
  await prisma.homeService.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.service.deleteMany();
  await prisma.serviceCategory.deleteMany();
  await prisma.businessGallery.deleteMany();
  await prisma.businessHours.deleteMany();
  await prisma.professional.deleteMany();
  await prisma.business.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany({ where: { role: { not: 'ADMIN' } } });
  await prisma.category.deleteMany();
  await prisma.feedbackReport.deleteMany();
}

// ─── categories ───────────────────────────────────────────────────────────────
async function seedCategories() {
  console.log('📂  Creando categorías...');
  await prisma.category.createMany({
    data: [
      { name: 'Barbería',         slug: 'BARBERSHOP', icon: '✂️' },
      { name: 'Spa & Wellness',   slug: 'SPA',        icon: '🧖' },
      { name: 'Salón de Belleza', slug: 'SALON',      icon: '💅' },
    ],
  });
}

// ─── 🇨🇴 el filo barber club — medellín ──────────────────────────────────────
async function seedElFilo() {
  console.log('🇨🇴  El Filo Barber Club (Medellín)...');

  const owner = await prisma.user.create({
    data: { email: 'diego.restrepo@elfilo.co', password: PWD, name: 'Diego Restrepo', phone: '+574 444 0101', role: 'BUSINESS_OWNER', country: 'CO' },
  });

  const biz = await prisma.business.create({
    data: {
      name: 'El Filo Barber Club', ownerId: owner.id,
      description: 'Más que una barbería, un club. Cortes premium, barba perfecta y ambiente de caballeros. El mejor fade de Medellín te espera en El Poblado.',
      address: 'Carrera 43A # 11-50, El Poblado', city: 'Medellín', state: 'Antioquia',
      country: 'CO', zipCode: '050021', timezone: 'America/Bogota',
      phone: '+57 4 444-0101', category: 'BARBERSHOP',
      accentColor: '#1A1A2E', logoUrl: IMG.elFilo_logo, coverUrl: IMG.elFilo_cover,
      status: 'ACTIVE', emailVerified: true, plan: 'studio', joinCode: 'ELFILO01',
      nameNorm: norm('El Filo Barber Club'), phoneNorm: norm('+574 444 0101'), addressNorm: norm('Carrera 43A 11-50 El Poblado'),
    },
  });

  await prisma.businessHours.createMany({
    data: bizHours({ 1:['08:00','20:00'], 2:['08:00','20:00'], 3:['08:00','20:00'], 4:['08:00','20:00'], 5:['08:00','20:00'], 6:['08:00','17:00'] })
      .map(h => ({ ...h, businessId: biz.id })),
  });

  const [catCortes, catBarba, catCombos] = await Promise.all([
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Cortes', sortOrder: 0 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Barba & Afeitado', sortOrder: 1 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Combos', sortOrder: 2 } }),
  ]);

  const [svcCorte, svcFade, svcBarba, svcAfeitado, svcCombo] = await Promise.all([
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCortes.id, name: 'Corte Clásico', description: 'Corte a tijera o máquina con acabado impecable.', duration: 30, price: 35000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCortes.id, name: 'Fade Degradado', description: 'Degradado de alta precisión, desde skin a high fade.', duration: 45, price: 45000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catBarba.id, name: 'Arreglo de Barba', description: 'Perfilado y arreglo de barba con toalla caliente.', duration: 20, price: 25000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catBarba.id, name: 'Afeitado con Navaja', description: 'Afeitado clásico con navaja, crema artesanal y toallas calientes.', duration: 30, price: 40000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCombos.id, name: 'Combo Total', description: 'Corte fade + arreglo de barba completo. La experiencia del caballero.', duration: 60, price: 65000 } }),
  ]);

  // Pro 1: Andrés Palomino
  const u1 = await prisma.user.create({ data: { email: 'andres.palomino@elfilo.co', password: PWD, name: 'Andrés Palomino', role: 'PROFESSIONAL', country: 'CO' } });
  const p1 = await prisma.professional.create({
    data: { name: 'Andrés Palomino', specialty: 'Fade & Degradados', bio: 'Especialista en fades y degradados de alta precisión. 5 años transformando looks en El Poblado. Cada corte es una obra de arte.', experience: '5 años', avatarUrl: IMG.man1, businessId: biz.id, userId: u1.id, country: 'CO', timezone: 'America/Bogota' },
  });
  await prisma.professional.update({ where: { id: p1.id }, data: { services: { connect: [{ id: svcCorte.id }, { id: svcFade.id }, { id: svcCombo.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 1:['08:00','16:00'], 2:['08:00','16:00'], 3:['08:00','16:00'], 4:['08:00','16:00'], 5:['08:00','16:00'], 6:['08:00','14:00'] }).map(s => ({ ...s, professionalId: p1.id })) });

  // Pro 2: Sebastián Mora (turno tarde)
  const u2 = await prisma.user.create({ data: { email: 'sebastian.mora@elfilo.co', password: PWD, name: 'Sebastián Mora', role: 'PROFESSIONAL', country: 'CO' } });
  const p2 = await prisma.professional.create({
    data: { name: 'Sebastián Mora', specialty: 'Barba & Estilos Creativos', bio: 'Barber con alma creativa. Especialista en barba, diseños y estilos personalizados. Turno tarde para quienes salen del trabajo.', experience: '3 años', avatarUrl: IMG.man2, businessId: biz.id, userId: u2.id, country: 'CO', timezone: 'America/Bogota' },
  });
  await prisma.professional.update({ where: { id: p2.id }, data: { services: { connect: [{ id: svcFade.id }, { id: svcBarba.id }, { id: svcAfeitado.id }, { id: svcCombo.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 2:['12:00','20:00'], 3:['12:00','20:00'], 4:['12:00','20:00'], 5:['12:00','20:00'], 6:['10:00','17:00'] }).map(s => ({ ...s, professionalId: p2.id })) });

  await prisma.businessGallery.createMany({ data: [
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=800&q=80', caption: 'Interior El Filo', sortOrder: 0 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&q=80', caption: 'Herramientas del oficio', sortOrder: 1 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&q=80', caption: 'Fade impecable', sortOrder: 2 },
  ]});

  await prisma.subscription.create({ data: { businessId: biz.id, plan: 'studio', country: 'CO', ...activePeriod() } });
  await prisma.subscription.createMany({ data: [
    { professionalId: p1.id, plan: 'team', country: 'CO', ...activePeriod() },
    { professionalId: p2.id, plan: 'team', country: 'CO', ...activePeriod() },
  ]});
}

// ─── 🇨🇴 aqua wellness spa — bogotá ──────────────────────────────────────────
async function seedAquaSpa() {
  console.log('🇨🇴  Aqua Wellness Spa (Bogotá)...');

  const owner = await prisma.user.create({
    data: { email: 'valentina.ospina@aquaspa.co', password: PWD, name: 'Valentina Ospina', phone: '+571 618 0202', role: 'BUSINESS_OWNER', country: 'CO' },
  });

  const biz = await prisma.business.create({
    data: {
      name: 'Aqua Wellness Spa', ownerId: owner.id,
      description: 'Un refugio de bienestar en el corazón de Bogotá. Terapias holísticas, tratamientos faciales de alta gama y masajes terapéuticos para reconectar cuerpo y mente.',
      address: 'Calle 93 # 15-40, Chico Norte', city: 'Bogotá', state: 'Cundinamarca',
      country: 'CO', zipCode: '110221', timezone: 'America/Bogota',
      phone: '+57 1 618-0202', category: 'SPA',
      accentColor: '#4A90A4', logoUrl: IMG.aqua_logo, coverUrl: IMG.aqua_cover,
      status: 'ACTIVE', emailVerified: true, plan: 'studio', joinCode: 'AQUASPA2',
      nameNorm: norm('Aqua Wellness Spa'), phoneNorm: norm('+571 618 0202'), addressNorm: norm('Calle 93 15-40 Chico Norte'),
    },
  });

  // Tue-Sat, Mon+Sun closed
  await prisma.businessHours.createMany({
    data: bizHours({ 2:['09:00','19:00'], 3:['09:00','19:00'], 4:['09:00','19:00'], 5:['09:00','19:00'], 6:['09:00','17:00'] })
      .map(h => ({ ...h, businessId: biz.id })),
  });

  const [catMasajes, catFaciales, catCuerpo] = await Promise.all([
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Masajes', sortOrder: 0 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Tratamientos Faciales', sortOrder: 1 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Tratamientos Corporales', sortOrder: 2 } }),
  ]);

  const [svcMasaje, svcPiedras, svcLimpieza, svcHidratacion, svcExfol] = await Promise.all([
    prisma.service.create({ data: { businessId: biz.id, categoryId: catMasajes.id, name: 'Masaje Relajante 60 min', description: 'Masaje sueco de cuerpo completo. Libera tensión y estrés acumulado.', duration: 60, price: 120000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catMasajes.id, name: 'Masaje con Piedras Calientes', description: 'Termoterapia profunda con piedras volcánicas. 90 minutos de pura relajación.', duration: 90, price: 180000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catFaciales.id, name: 'Limpieza Facial Profunda', description: 'Limpieza, exfoliación y mascarilla personalizada según tipo de piel.', duration: 75, price: 150000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catFaciales.id, name: 'Hidratación Facial Premium', description: 'Tratamiento con ácido hialurónico y vitamina C. Piel luminosa garantizada.', duration: 60, price: 130000 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCuerpo.id, name: 'Exfoliación Corporal', description: 'Scrub de azúcar y aceites esenciales. Renueva tu piel de pies a cabeza.', duration: 60, price: 110000 } }),
  ]);

  // Pro 1: Camila Torres
  const u3 = await prisma.user.create({ data: { email: 'camila.torres@aquaspa.co', password: PWD, name: 'Camila Torres', role: 'PROFESSIONAL', country: 'CO' } });
  const p3 = await prisma.professional.create({
    data: { name: 'Camila Torres', specialty: 'Masoterapia & Técnicas Orientales', bio: 'Terapeuta certificada en masoterapia, shiatsu y técnicas orientales. 6 años dedicados al bienestar integral. Cada sesión es un viaje interior.', experience: '6 años', avatarUrl: IMG.woman1, businessId: biz.id, userId: u3.id, country: 'CO', timezone: 'America/Bogota' },
  });
  await prisma.professional.update({ where: { id: p3.id }, data: { services: { connect: [{ id: svcMasaje.id }, { id: svcPiedras.id }, { id: svcExfol.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 2:['09:00','17:00'], 3:['09:00','17:00'], 4:['09:00','17:00'], 5:['09:00','17:00'], 6:['10:00','16:00'] }).map(s => ({ ...s, professionalId: p3.id })) });

  // Pro 2: Isabella Mendoza (miér-sáb)
  const u4 = await prisma.user.create({ data: { email: 'isabella.mendoza@aquaspa.co', password: PWD, name: 'Isabella Mendoza', role: 'PROFESSIONAL', country: 'CO' } });
  const p4 = await prisma.professional.create({
    data: { name: 'Isabella Mendoza', specialty: 'Tratamientos Faciales & Aromaterapia', bio: 'Especialista en tratamientos faciales de alta gama y aromaterapia. Resultados visibles desde la primera sesión. Tu piel lo merece.', experience: '4 años', avatarUrl: IMG.woman2, businessId: biz.id, userId: u4.id, country: 'CO', timezone: 'America/Bogota' },
  });
  await prisma.professional.update({ where: { id: p4.id }, data: { services: { connect: [{ id: svcLimpieza.id }, { id: svcHidratacion.id }, { id: svcMasaje.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 3:['10:00','19:00'], 4:['10:00','19:00'], 5:['10:00','19:00'], 6:['10:00','17:00'] }).map(s => ({ ...s, professionalId: p4.id })) });

  await prisma.businessGallery.createMany({ data: [
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1571019613914-85f342c6a11e?w=800&q=80', caption: 'Sala de masajes', sortOrder: 0 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&q=80', caption: 'Ambiente Aqua', sortOrder: 1 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&q=80', caption: 'Piedras calientes', sortOrder: 2 },
  ]});

  await prisma.subscription.create({ data: { businessId: biz.id, plan: 'studio', country: 'CO', ...activePeriod() } });
  await prisma.subscription.createMany({ data: [
    { professionalId: p3.id, plan: 'team', country: 'CO', ...activePeriod() },
    { professionalId: p4.id, plan: 'team', country: 'CO', ...activePeriod() },
  ]});
}

// ─── 🇺🇸 the fade lounge — miami ─────────────────────────────────────────────
async function seedFadeLounge() {
  console.log('🇺🇸  The Fade Lounge (Miami, FL)...');

  const owner = await prisma.user.create({
    data: { email: 'marcus.johnson@fadelounge.us', password: PWD, name: 'Marcus Johnson', phone: '+1 305 555 0303', role: 'BUSINESS_OWNER', country: 'US' },
  });

  const biz = await prisma.business.create({
    data: {
      name: 'The Fade Lounge', ownerId: owner.id,
      description: "Miami's premier barbershop. Precision fades, sharp line-ups, and old-school hot towel shaves. We don't just cut hair — we craft confidence.",
      address: '1428 Brickell Ave, Brickell', city: 'Miami', state: 'FL',
      country: 'US', zipCode: '33131', timezone: 'America/New_York',
      phone: '+1 305 555-0303', category: 'BARBERSHOP',
      accentColor: '#2D3436', logoUrl: IMG.fade_logo, coverUrl: IMG.fade_cover,
      status: 'ACTIVE', emailVerified: true, plan: 'studio', joinCode: 'FADELOUNG',
      nameNorm: norm('The Fade Lounge'), phoneNorm: norm('+1 305 555 0303'), addressNorm: norm('1428 Brickell Ave Brickell'),
    },
  });

  await prisma.businessHours.createMany({
    data: bizHours({ 1:['10:00','20:00'], 2:['10:00','21:00'], 3:['10:00','21:00'], 4:['10:00','21:00'], 5:['10:00','21:00'], 6:['09:00','18:00'] })
      .map(h => ({ ...h, businessId: biz.id })),
  });

  const [catCuts, catBeard, catPkgs] = await Promise.all([
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Cuts', sortOrder: 0 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Beard & Shave', sortOrder: 1 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Packages', sortOrder: 2 } }),
  ]);

  const [svcClassic, svcSkin, svcTextured, svcBeard, svcHotShave, svcFull] = await Promise.all([
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCuts.id, name: 'Classic Cut', description: 'Clean scissor or clipper cut with a finished look.', duration: 30, price: 35 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCuts.id, name: 'Skin Fade', description: 'Precision skin-to-high fade. Our signature cut.', duration: 45, price: 45 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catCuts.id, name: 'Textured / Curly Cut', description: 'Waves, curls and coils cut for natural texture and shape.', duration: 45, price: 50 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catBeard.id, name: 'Beard Trim & Shape', description: 'Precision beard line-up and shaping.', duration: 20, price: 25 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catBeard.id, name: 'Hot Towel Shave', description: 'Classic straight razor shave with hot towel and premium cream.', duration: 30, price: 40 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catPkgs.id, name: 'Full Service (Cut + Beard)', description: 'Skin fade + beard trim & shape. The complete Fade Lounge experience.', duration: 60, price: 65 } }),
  ]);

  // Pro 3: Damon Rivera (morning shift)
  const u5 = await prisma.user.create({ data: { email: 'damon.rivera@fadelounge.us', password: PWD, name: 'Damon Rivera', role: 'PROFESSIONAL', country: 'US' } });
  const p5 = await prisma.professional.create({
    data: { name: 'Damon Rivera', specialty: 'Fades & Line-Ups', bio: 'Master barber with 7 years in the game. Known for precision fades and sharp line-ups. Every client leaves looking fresh and confident.', experience: '7 years', avatarUrl: IMG.man3, businessId: biz.id, userId: u5.id, country: 'US', timezone: 'America/New_York' },
  });
  await prisma.professional.update({ where: { id: p5.id }, data: { services: { connect: [{ id: svcClassic.id }, { id: svcSkin.id }, { id: svcBeard.id }, { id: svcFull.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 1:['10:00','18:00'], 2:['10:00','18:00'], 3:['10:00','18:00'], 4:['10:00','18:00'], 5:['10:00','18:00'], 6:['09:00','16:00'] }).map(s => ({ ...s, professionalId: p5.id })) });

  // Pro 4: Tyler Brooks (evening shift)
  const u6 = await prisma.user.create({ data: { email: 'tyler.brooks@fadelounge.us', password: PWD, name: 'Tyler Brooks', role: 'PROFESSIONAL', country: 'US' } });
  const p6 = await prisma.professional.create({
    data: { name: 'Tyler Brooks', specialty: 'Textured Hair & Waves', bio: 'Textured hair specialist. Waves, curls, twists and everything in between. Evening shift — book your after-work slot.', experience: '4 years', avatarUrl: IMG.man4, businessId: biz.id, userId: u6.id, country: 'US', timezone: 'America/New_York' },
  });
  await prisma.professional.update({ where: { id: p6.id }, data: { services: { connect: [{ id: svcTextured.id }, { id: svcSkin.id }, { id: svcHotShave.id }, { id: svcFull.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 2:['13:00','21:00'], 3:['13:00','21:00'], 4:['13:00','21:00'], 5:['13:00','21:00'], 6:['09:00','18:00'] }).map(s => ({ ...s, professionalId: p6.id })) });

  await prisma.businessGallery.createMany({ data: [
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=80', caption: 'The Fade Lounge interior', sortOrder: 0 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&q=80', caption: 'Precision tools', sortOrder: 1 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=800&q=80', caption: 'Fresh skin fade', sortOrder: 2 },
  ]});

  await prisma.subscription.create({ data: { businessId: biz.id, plan: 'studio', country: 'US', ...activePeriod() } });
  await prisma.subscription.createMany({ data: [
    { professionalId: p5.id, plan: 'team', country: 'US', ...activePeriod() },
    { professionalId: p6.id, plan: 'team', country: 'US', ...activePeriod() },
  ]});
}

// ─── 🇺🇸 bloom beauty studio — los angeles ────────────────────────────────────
async function seedBloomBeauty() {
  console.log('🇺🇸  Bloom Beauty Studio (Los Angeles, CA)...');

  const owner = await prisma.user.create({
    data: { email: 'sophia.chen@bloombeauty.us', password: PWD, name: 'Sophia Chen', phone: '+1 323 555 0404', role: 'BUSINESS_OWNER', country: 'US' },
  });

  const biz = await prisma.business.create({
    data: {
      name: 'Bloom Beauty Studio', ownerId: owner.id,
      description: "West Hollywood's boutique beauty studio. Expert nails, flawless brows, and stunning lash extensions. Where your beauty story begins.",
      address: '8605 Santa Monica Blvd, West Hollywood', city: 'Los Angeles', state: 'CA',
      country: 'US', zipCode: '90069', timezone: 'America/Los_Angeles',
      phone: '+1 323 555-0404', category: 'SALON',
      accentColor: '#E8A0BF', logoUrl: IMG.bloom_logo, coverUrl: IMG.bloom_cover,
      status: 'ACTIVE', emailVerified: true, plan: 'team', joinCode: 'BLOOMLA04',
      nameNorm: norm('Bloom Beauty Studio'), phoneNorm: norm('+1 323 555 0404'), addressNorm: norm('8605 Santa Monica Blvd West Hollywood'),
    },
  });

  await prisma.businessHours.createMany({
    data: bizHours({ 1:['10:00','19:00'], 2:['09:00','18:00'], 3:['09:00','18:00'], 4:['09:00','18:00'], 5:['09:00','18:00'], 6:['09:00','17:00'] })
      .map(h => ({ ...h, businessId: biz.id })),
  });

  const [catNails, catBrows] = await Promise.all([
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Nail Services', sortOrder: 0 } }),
    prisma.serviceCategory.create({ data: { businessId: biz.id, name: 'Brows & Lashes', sortOrder: 1 } }),
  ]);

  const [svcManicure, svcGel, svcPedicure, svcNailArt, svcBrows, svcLashes] = await Promise.all([
    prisma.service.create({ data: { businessId: biz.id, categoryId: catNails.id, name: 'Classic Manicure', description: 'Shape, buff and polish. Timeless elegance for your nails.', duration: 45, price: 45 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catNails.id, name: 'Gel/Shellac Manicure', description: 'Long-lasting gel finish. Chip-free for up to 3 weeks.', duration: 60, price: 65 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catNails.id, name: 'Spa Pedicure', description: 'Foot soak, exfoliation, cuticle care and polish. Pure relaxation.', duration: 60, price: 75 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catNails.id, name: 'Nail Art (per hand)', description: 'Custom nail art design. From minimalist to bold — you dream it, we create it.', duration: 30, price: 35 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catBrows.id, name: 'Eyebrow Shaping & Tint', description: 'Precision wax or thread shaping plus tint for defined, natural brows.', duration: 45, price: 55 } }),
    prisma.service.create({ data: { businessId: biz.id, categoryId: catBrows.id, name: 'Lash Extensions (Full Set)', description: 'Classic lash extensions for natural to dramatic volume. Lasts 4–6 weeks.', duration: 90, price: 150 } }),
  ]);

  // Pro 5: Jasmine Park
  const u7 = await prisma.user.create({ data: { email: 'jasmine.park@bloombeauty.us', password: PWD, name: 'Jasmine Park', role: 'PROFESSIONAL', country: 'US' } });
  const p7 = await prisma.professional.create({
    data: { name: 'Jasmine Park', specialty: 'Nail Art & Gel Manicure', bio: 'Nail artist with an eye for detail and a love for creativity. From minimalist classics to bold statement nails — your nails, your story.', experience: '5 years', avatarUrl: IMG.woman3, businessId: biz.id, userId: u7.id, country: 'US', timezone: 'America/Los_Angeles' },
  });
  await prisma.professional.update({ where: { id: p7.id }, data: { services: { connect: [{ id: svcManicure.id }, { id: svcGel.id }, { id: svcPedicure.id }, { id: svcNailArt.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 1:['09:00','17:00'], 2:['09:00','17:00'], 3:['09:00','17:00'], 4:['09:00','17:00'], 5:['09:00','17:00'], 6:['09:00','15:00'] }).map(s => ({ ...s, professionalId: p7.id })) });

  // Pro 6: Mia Rodriguez (mar-sáb)
  const u8 = await prisma.user.create({ data: { email: 'mia.rodriguez@bloombeauty.us', password: PWD, name: 'Mia Rodriguez', role: 'PROFESSIONAL', country: 'US' } });
  const p8 = await prisma.professional.create({
    data: { name: 'Mia Rodriguez', specialty: 'Brows & Lash Extensions', bio: 'Brow and lash specialist dedicated to enhancing your natural beauty. Precision shaping, perfect tints, and lash extensions that turn heads.', experience: '3 years', avatarUrl: IMG.woman4, businessId: biz.id, userId: u8.id, country: 'US', timezone: 'America/Los_Angeles' },
  });
  await prisma.professional.update({ where: { id: p8.id }, data: { services: { connect: [{ id: svcBrows.id }, { id: svcLashes.id }, { id: svcManicure.id }] } } });
  await prisma.schedule.createMany({ data: weekSchedule({ 2:['10:00','18:00'], 3:['10:00','18:00'], 4:['10:00','18:00'], 5:['10:00','18:00'], 6:['09:00','17:00'] }).map(s => ({ ...s, professionalId: p8.id })) });

  await prisma.businessGallery.createMany({ data: [
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=800&q=80', caption: 'Nail art at Bloom', sortOrder: 0 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&q=80', caption: 'Studio interior', sortOrder: 1 },
    { businessId: biz.id, url: 'https://images.unsplash.com/photo-1610992015732-2449b0dd2b8d?w=800&q=80', caption: 'Flawless brows', sortOrder: 2 },
  ]});

  await prisma.subscription.create({ data: { businessId: biz.id, plan: 'team', country: 'US', ...activePeriod() } });
  await prisma.subscription.createMany({ data: [
    { professionalId: p7.id, plan: 'team', country: 'US', ...activePeriod() },
    { professionalId: p8.id, plan: 'team', country: 'US', ...activePeriod() },
  ]});
}

// ─── 🏠 home service professionals ───────────────────────────────────────────
async function seedHomePros() {
  console.log('🏠  Profesionales a domicilio...');

  // Laura Vargas — CO
  const uLaura = await prisma.user.create({ data: { email: 'laura.vargas@pro.co', password: PWD, name: 'Laura Vargas', role: 'PROFESSIONAL', country: 'CO' } });
  const laura = await prisma.professional.create({
    data: {
      name: 'Laura Vargas', specialty: 'Manicura & Cosmetología',
      bio: 'Manicurista y cosmetóloga certificada con 4 años de experiencia. Llevo el spa a tu hogar con productos premium y técnicas profesionales. Medellín y área metropolitana.',
      experience: '4 años',
      avatarUrl: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=400&q=80',
      offersHomeService: true,
      homeServiceArea: JSON.stringify({ cities: ['Medellín', 'Envigado', 'Sabaneta', 'Itagüí', 'Bello'] }),
      homeServiceSurcharge: 15000,
      homeServiceNotes: 'Incluye traslado en toda el área metropolitana. Mínimo 2 servicios por visita. Acepta efectivo y Nequi.',
      userId: uLaura.id, country: 'CO', timezone: 'America/Bogota',
    },
  });
  await prisma.homeService.createMany({ data: [
    { professionalId: laura.id, name: 'Manicure Clásico a Domicilio', description: 'Lima, cutícula, esmalte a tu elección. Técnica impecable en tu casa.', duration: 45, price: 50000, isActive: true },
    { professionalId: laura.id, name: 'Manicure Semipermanente', description: 'Esmalte semipermanente de larga duración. Dura hasta 3 semanas.', duration: 60, price: 70000, isActive: true },
    { professionalId: laura.id, name: 'Pedicure Spa', description: 'Baño de pies, exfoliación, masaje y esmalte. Relajación total en tu hogar.', duration: 60, price: 65000, isActive: true },
    { professionalId: laura.id, name: 'Diseño de Cejas + Labio', description: 'Depilación y diseño de cejas con hilo o cera, más labio superior.', duration: 30, price: 35000, isActive: true },
  ]});
  await prisma.homeSchedule.createMany({ data: [
    { professionalId: laura.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true },
    { professionalId: laura.id, dayOfWeek: 2, startTime: '09:00', endTime: '18:00', isActive: true },
    { professionalId: laura.id, dayOfWeek: 3, startTime: '09:00', endTime: '18:00', isActive: true },
    { professionalId: laura.id, dayOfWeek: 4, startTime: '09:00', endTime: '18:00', isActive: true },
    { professionalId: laura.id, dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
    { professionalId: laura.id, dayOfWeek: 6, startTime: '10:00', endTime: '15:00', isActive: true },
  ]});
  await prisma.subscription.create({ data: { professionalId: laura.id, plan: 'solo', country: 'CO', ...activePeriod() } });

  // Jordan Wells — US
  const uJordan = await prisma.user.create({ data: { email: 'jordan.wells@pro.us', password: PWD, name: 'Jordan Wells', role: 'PROFESSIONAL', country: 'US' } });
  const jordan = await prisma.professional.create({
    data: {
      name: 'Jordan Wells', specialty: 'Mobile Massage Therapy',
      bio: 'Licensed massage therapist bringing spa-quality treatments to your door. Specializing in relaxation, deep tissue, and sports recovery. Serving greater LA area.',
      experience: '6 years',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80',
      offersHomeService: true,
      homeServiceArea: JSON.stringify({ cities: ['Los Angeles', 'Santa Monica', 'West Hollywood', 'Beverly Hills', 'Culver City'] }),
      homeServiceSurcharge: 25,
      homeServiceNotes: 'Brings massage table and all supplies. Travel fee included. 24hr cancellation policy. Card or Venmo.',
      userId: uJordan.id, country: 'US', timezone: 'America/Los_Angeles', state: 'CA', zipCode: '90028',
    },
  });
  await prisma.homeService.createMany({ data: [
    { professionalId: jordan.id, name: 'Swedish Relaxation Massage (60 min)', description: 'Full-body Swedish massage to melt away stress. Includes aromatherapy.', duration: 60, price: 110, isActive: true },
    { professionalId: jordan.id, name: 'Deep Tissue Massage (60 min)', description: 'Targeted deep tissue work for chronic muscle tension and pain relief.', duration: 60, price: 130, isActive: true },
    { professionalId: jordan.id, name: 'Sports Recovery Massage (45 min)', description: 'Focused on key muscle groups for athletes. Improves range of motion.', duration: 45, price: 95, isActive: true },
    { professionalId: jordan.id, name: 'Extended Relaxation Massage (90 min)', description: 'The ultimate relaxation experience. 90 minutes of pure stress relief.', duration: 90, price: 165, isActive: true },
  ]});
  await prisma.homeSchedule.createMany({ data: [
    { professionalId: jordan.id, dayOfWeek: 1, startTime: '10:00', endTime: '20:00', isActive: true },
    { professionalId: jordan.id, dayOfWeek: 2, startTime: '10:00', endTime: '20:00', isActive: true },
    { professionalId: jordan.id, dayOfWeek: 3, startTime: '10:00', endTime: '20:00', isActive: true },
    { professionalId: jordan.id, dayOfWeek: 4, startTime: '10:00', endTime: '20:00', isActive: true },
    { professionalId: jordan.id, dayOfWeek: 5, startTime: '10:00', endTime: '20:00', isActive: true },
    { professionalId: jordan.id, dayOfWeek: 6, startTime: '10:00', endTime: '16:00', isActive: true },
  ]});
  await prisma.subscription.create({ data: { professionalId: jordan.id, plan: 'solo', country: 'US', ...activePeriod() } });
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱  Iniciando seed demo de Bookease...\n');
  await cleanup();
  await seedCategories();
  await seedElFilo();
  await seedAquaSpa();
  await seedFadeLounge();
  await seedBloomBeauty();
  await seedHomePros();

  const counts = {
    users:         await prisma.user.count(),
    businesses:    await prisma.business.count(),
    professionals: await prisma.professional.count(),
    services:      await prisma.service.count(),
    homeServices:  await prisma.homeService.count(),
    schedules:     await prisma.schedule.count(),
    subscriptions: await prisma.subscription.count(),
  };

  console.log('\n✅  Seed completado!\n');
  console.log('📊  Resumen:');
  Object.entries(counts).forEach(([k, v]) => console.log(`    ${k}: ${v}`));
  console.log('\n🔑  Contraseña demo para todos los usuarios: demo1234\n');
  console.log('🇨🇴  El Filo Barber Club — diego.restrepo@elfilo.co');
  console.log('🇨🇴  Aqua Wellness Spa   — valentina.ospina@aquaspa.co');
  console.log('🇺🇸  The Fade Lounge     — marcus.johnson@fadelounge.us');
  console.log('🇺🇸  Bloom Beauty Studio — sophia.chen@bloombeauty.us');
  console.log('🏠  Laura Vargas (CO)   — laura.vargas@pro.co');
  console.log('🏠  Jordan Wells (US)   — jordan.wells@pro.us\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
