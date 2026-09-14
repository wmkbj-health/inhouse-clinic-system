// Minimal dependency-free inline-SVG charts. Kept intentionally small (no
// charting library) so the app stays a pure static site with no build step
// and no extra network dependency beyond what it already needs.
import { escapeHtml } from './util.js';

const PALETTE = ['#1e88e5', '#43a047', '#f5a623', '#ef5350', '#8e24aa', '#00897b', '#6d4c41'];

let uidCounter = 0;
const uid = prefix => `${prefix}-${++uidCounter}`;

// Smooth quadratic-through-midpoints curve — visually close to a spline
// without needing an actual spline library: each segment curves through
// the midpoint of its two endpoints, which is enough to turn the previous
// sharp zig-zag line into something that reads as a modern trend line.
function smoothPath(points) {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const mx = ((x0 + x1) / 2).toFixed(1), my = ((y0 + y1) / 2).toFixed(1);
    d += ` Q${x0},${y0} ${mx},${my}`;
  }
  const last = points[points.length - 1];
  d += ` L${last[0]},${last[1]}`;
  return d;
}

export function lineChart(labels, values, { color = '#1e88e5', height = 220 } = {}) {
  const w = 600, h = height, padL = 34, padR = 14, padT = 16, padB = 26;
  const max = Math.max(1, ...values);
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const points = values.map((v, i) => [padL + i * stepX, padT + innerH - (v / max) * innerH]);
  const pathD = smoothPath(points);
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${padT + innerH} L${points[0][0].toFixed(1)},${padT + innerH} Z`;
  const gradId = uid('lineGrad');
  const gridLines = Array.from({ length: 4 }, (_, i) => {
    const y = padT + (innerH / 3) * i;
    const val = Math.round(max - (max / 3) * i);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" class="chart-grid"></line><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="chart-axis-y">${val}</text>`;
  }).join('');
  const dots = points.map((p, i) => `<circle class="chart-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${color}"><title>${escapeHtml(labels[i])}: ${values[i]}</title></circle>`).join('');
  const xLabels = labels.map((l, i) => `<text x="${points[i][0].toFixed(1)}" y="${h - 6}" class="chart-axis-x">${escapeHtml(l)}</text>`).join('');
  return `
    <svg class="chart chart-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafik garis">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity=".32"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaD}" fill="url(#${gradId})" stroke="none"></path>
      <path class="chart-line-path" d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1"></path>
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
  const grads = PALETTE.map((color, i) => {
    const id = `barGrad-${uidCounter + 1}-${i}`;
    return { id, color, def: `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".85"></stop><stop offset="100%" stop-color="${color}"></stop></linearGradient>` };
  });
  uidCounter++;
  const bars = items.map((it, i) => {
    const x = padL + i * (barW + gap);
    const barH = (it.value / max) * innerH;
    const y = padT + innerH - barH;
    const g = grads[i % grads.length];
    return `
      <rect class="chart-bar-rect" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="6" fill="url(#${g.id})"><title>${escapeHtml(it.label)}: ${it.value}</title></rect>
      <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="chart-bar-value" text-anchor="middle">${it.value}</text>
      <text x="${(x + barW / 2).toFixed(1)}" y="${h - 10}" class="chart-axis-x" text-anchor="middle">${escapeHtml(truncate(it.label, 16))}</text>`;
  }).join('');
  return `<svg class="chart chart-bar" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafik batang"><defs>${grads.map(g => g.def).join('')}</defs>${bars}</svg>`;
}

export function pieChart(items, { size = 200 } = {}) {
  // items: [{ label, value }] — rendered as a donut (stroked circle
  // segments) with the total in the center, rather than a filled pie: it
  // reads as more modern and gives the total a place to live without an
  // extra line of text above the chart.
  const total = items.reduce((s, it) => s + it.value, 0);
  const cx = size / 2, cy = size / 2;
  const strokeW = Math.max(14, size * 0.11);
  const r = size / 2 - strokeW / 2 - 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  let ring;
  if (total <= 0) {
    ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${strokeW}"></circle>`;
  } else {
    ring = items.map((it, i) => {
      if (it.value <= 0) return '';
      const frac = it.value / total;
      const dash = frac * circumference;
      const gapLen = circumference - dash;
      const rotate = (acc / circumference) * 360 - 90;
      acc += dash;
      const color = PALETTE[i % PALETTE.length];
      return `<circle class="chart-donut-seg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-dasharray="${dash.toFixed(2)} ${gapLen.toFixed(2)}" transform="rotate(${rotate.toFixed(2)} ${cx} ${cy})"><title>${escapeHtml(it.label)}: ${it.value} (${(frac * 100).toFixed(1)}%)</title></circle>`;
    }).join('');
  }
  const legend = items.map((it, i) => `
    <div class="chart-legend-item"><span class="chart-legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(it.label)} — <b>${it.value}</b></div>
  `).join('');
  return `
    <div class="chart-pie-wrap">
      <svg class="chart chart-pie" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Grafik donat">
        ${ring}
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" class="chart-donut-total">${total}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="chart-donut-label">Total</text>
      </svg>
      <div class="chart-legend">${legend || '<span class="muted" style="font-size:.8rem">Belum ada data.</span>'}</div>
    </div>`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
