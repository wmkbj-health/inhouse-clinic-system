// Minimal dependency-free inline-SVG charts. Kept intentionally small (no
// charting library) so the app stays a pure static site with no build step
// and no extra network dependency beyond what it already needs.
import { escapeHtml } from './util.js';

const PALETTE = ['#1e88e5', '#43a047', '#f5a623', '#ef5350', '#8e24aa', '#00897b', '#6d4c41'];

export function lineChart(labels, values, { color = '#1e88e5', height = 220 } = {}) {
  const w = 600, h = height, padL = 34, padR = 14, padT = 16, padB = 26;
  const max = Math.max(1, ...values);
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const points = values.map((v, i) => [padL + i * stepX, padT + innerH - (v / max) * innerH]);
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${padT + innerH} L${points[0][0].toFixed(1)},${padT + innerH} Z`;
  const gridLines = Array.from({ length: 4 }, (_, i) => {
    const y = padT + (innerH / 3) * i;
    const val = Math.round(max - (max / 3) * i);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" class="chart-grid"></line><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="chart-axis-y">${val}</text>`;
  }).join('');
  const dots = points.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${color}"><title>${escapeHtml(labels[i])}: ${values[i]}</title></circle>`).join('');
  const xLabels = labels.map((l, i) => `<text x="${points[i][0].toFixed(1)}" y="${h - 6}" class="chart-axis-x">${escapeHtml(l)}</text>`).join('');
  return `
    <svg class="chart chart-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafik garis">
      ${gridLines}
      <path d="${areaD}" fill="${color}" opacity=".12" stroke="none"></path>
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
      ${dots}
      ${xLabels}
    </svg>`;
}

export function barChart(items, { height = 220 } = {}) {
  // items: [{ label, value }]
  const w = 600, h = height, padL = 14, padR = 14, padT = 14, padB = 34;
  const max = Math.max(1, ...items.map(it => it.value));
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const n = Math.max(1, items.length);
  const gap = 14;
  const barW = (innerW - gap * (n - 1)) / n;
  const bars = items.map((it, i) => {
    const x = padL + i * (barW + gap);
    const barH = (it.value / max) * innerH;
    const y = padT + innerH - barH;
    const color = PALETTE[i % PALETTE.length];
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" fill="${color}"><title>${escapeHtml(it.label)}: ${it.value}</title></rect>
      <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="chart-bar-value" text-anchor="middle">${it.value}</text>
      <text x="${(x + barW / 2).toFixed(1)}" y="${h - 10}" class="chart-axis-x" text-anchor="middle">${escapeHtml(truncate(it.label, 16))}</text>`;
  }).join('');
  return `<svg class="chart chart-bar" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafik batang">${bars}</svg>`;
}

export function pieChart(items, { size = 200 } = {}) {
  // items: [{ label, value }]
  const total = items.reduce((s, it) => s + it.value, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  let angle = -Math.PI / 2;
  const slices = [];
  if (total <= 0) {
    slices.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--surface-3)"></circle>`);
  } else {
    items.forEach((it, i) => {
      if (it.value <= 0) return;
      const frac = it.value / total;
      const nextAngle = angle + frac * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(nextAngle), y2 = cy + r * Math.sin(nextAngle);
      const largeArc = frac > 0.5 ? 1 : 0;
      const color = PALETTE[i % PALETTE.length];
      slices.push(`<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"><title>${escapeHtml(it.label)}: ${it.value} (${(frac * 100).toFixed(1)}%)</title></path>`);
      angle = nextAngle;
    });
  }
  const legend = items.map((it, i) => `
    <div class="chart-legend-item"><span class="chart-legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(it.label)} — <b>${it.value}</b></div>
  `).join('');
  return `
    <div class="chart-pie-wrap">
      <svg class="chart chart-pie" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Grafik pie">${slices.join('')}</svg>
      <div class="chart-legend">${legend || '<span class="muted" style="font-size:.8rem">Belum ada data.</span>'}</div>
    </div>`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
