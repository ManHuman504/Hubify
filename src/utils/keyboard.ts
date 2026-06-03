/**
 * Keyboard layout transliteration utility
 *
 * Handles two common cases:
 * 1. User types on RU layout but physically hits EN keys  → convert EN chars to RU
 * 2. User types on EN layout but physically hits RU keys  → convert RU chars to EN
 *
 * Also handles Cyrillic → Latin transliteration for fuzzy matching.
 */

// EN key → what you get on RU layout (ЙЦУКЕН)
const EN_TO_RU: Record<string, string> = {
  q:'й', w:'ц', e:'у', r:'к', t:'е', y:'н', u:'г', i:'ш', o:'щ', p:'з',
  '[':'х', ']':'ъ', a:'ф', s:'ы', d:'в', f:'а', g:'п', h:'р', j:'о',
  k:'л', l:'д', ';':'ж', "'":"э", z:'я', x:'ч', c:'с', v:'м', b:'и',
  n:'т', m:'ь', ',':'б', '.':'ю', '/':'.',
  Q:'Й', W:'Ц', E:'У', R:'К', T:'Е', Y:'Н', U:'Г', I:'Ш', O:'Щ', P:'З',
  '{':'Х', '}':'Ъ', A:'Ф', S:'Ы', D:'В', F:'А', G:'П', H:'Р', J:'О',
  K:'Л', L:'Д', ':':'Ж', '"':'Э', Z:'Я', X:'Ч', C:'С', V:'М', B:'И',
  N:'Т', M:'Ь', '<':'Б', '>':'Ю',
}

// RU key → EN (reverse)
const RU_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_RU).map(([k, v]) => [v, k])
)

// Cyrillic → Latin transliteration (for fuzzy matching)
const CYR_TO_LAT: Record<string, string> = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'yo', ж:'zh', з:'z',
  и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r',
  с:'s', т:'t', у:'u', ф:'f', х:'kh', ц:'ts', ч:'ch', ш:'sh', щ:'sch',
  ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya',
}

function transliterate(str: string, map: Record<string, string>): string {
  return str.split('').map(ch => map[ch] ?? ch).join('')
}

export function cyrToLat(str: string): string {
  return transliterate(str.toLowerCase(), CYR_TO_LAT)
}

/** Convert a string typed on EN layout as if it were typed on RU layout */
export function enAsRu(str: string): string {
  return transliterate(str, EN_TO_RU)
}

/** Convert a string typed on RU layout as if it were typed on EN layout */
export function ruAsEn(str: string): string {
  return transliterate(str, RU_TO_EN)
}

/**
 * Smart search: returns true if `target` matches `query` regardless of keyboard layout.
 * Checks: direct, EN→RU swap, RU→EN swap, cyrToLat transliteration.
 */
export function layoutAwareMatch(target: string, query: string): boolean {
  if (!query) return true
  const t = target.toLowerCase()
  const q = query.toLowerCase()

  return (
    t.includes(q) ||
    t.includes(enAsRu(q)) ||
    t.includes(ruAsEn(q)) ||
    cyrToLat(t).includes(q) ||
    cyrToLat(t).includes(cyrToLat(q))
  )
}
