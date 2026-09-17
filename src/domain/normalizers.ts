const NON_ALNUM = /[^a-z0-9]+/g;

export function normalizeName(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(NON_ALNUM, '').trim();
}

export function normalizeTown(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(NON_ALNUM, '').trim();
}

const STREET_SUFFIXES: [string, string][] = [
  ['boulevard', 'blvd'],
  ['avenue', 'ave'],
  ['street', 'st'],
  ['road', 'rd'],
  ['drive', 'dr'],
  ['lane', 'ln'],
  ['court', 'ct'],
  ['place', 'pl'],
  ['apartment', 'apt'],
];

export function normalizeStreet(s: string): string {
  if (!s) return '';
  let str = s.toLowerCase();
  for (const [long, short] of STREET_SUFFIXES) {
    str = str.replaceAll(long, short);
  }
  return str.replace(NON_ALNUM, '').trim();
}

export function parseLegacyName(name: string): { last: string; first: string } {
  if (!name) return { last: '', first: '' };
  const idx = name.indexOf(',');
  if (idx >= 0) {
    return {
      last: normalizeName(name.substring(0, idx)),
      first: normalizeName(name.substring(idx + 1)),
    };
  }
  return {
    last: '',
    first: normalizeName(name),
  };
}

export function soundex(s: string): string {
  if (!s) return '';
  let clean = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length === 0) return '';

  // Canonicalize leading phonetic variants (K/C, PH/F, WR/R)
  clean = clean.replace(/^K(?=[AEOUY])/i, 'C');
  clean = clean.replace(/^PH/i, 'F');
  clean = clean.replace(/^WR/i, 'R');

  const mapping: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  const first = clean[0];
  let res = first;
  let prevCode = mapping[first] || '0';

  for (let i = 1; i < clean.length; i++) {
    const char = clean[i];
    const code = mapping[char] || '0';
    if (code !== '0' && code !== prevCode) {
      res += code;
    }
    prevCode = code;
  }

  res = res.padEnd(4, '0').slice(0, 4);
  return res;
}
