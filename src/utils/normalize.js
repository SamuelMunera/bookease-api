const ADDR_ABBR = {
  calle: 'cl', carrera: 'cr', avenida: 'av', diagonal: 'dg', transversal: 'tv',
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr', road: 'rd', lane: 'ln',
};

function normStr(s = '') {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s#\-]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function normalizeName(s = '') {
  return normStr(s).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(s = '') {
  return (s || '').replace(/\D/g, '');
}

function normalizeAddress(s = '') {
  let n = normStr(s);
  for (const [full, short] of Object.entries(ADDR_ABBR)) {
    n = n.replace(new RegExp(`\\b${full}\\b`, 'g'), short);
  }
  return n.replace(/\s+/g, ' ').trim();
}

module.exports = { normalizeName, normalizePhone, normalizeAddress };
