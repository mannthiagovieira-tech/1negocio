// MANDATO · helpers de formatação · puros, sem side effects.

const fmtBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtBRLCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
  minimumFractionDigits: 0, maximumFractionDigits: 0,
});

/** R$ 12.345,67 · null/undefined/NaN → em-dash */
export function brl(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isFinite(v) ? fmtBRL.format(v) : '—';
}

/** R$ 12.346 (0 casas) · para KPIs grandes */
export function brlCompact(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isFinite(v) ? fmtBRLCompact.format(v) : '—';
}

/** 1.234 · pt-BR sem decimais */
export function num(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('pt-BR') : '—';
}

/** dd/mm/yyyy · aceita ISO ou Date · null → em-dash */
export function dataBR(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

/** escape HTML seguro para interpolação em template strings */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
