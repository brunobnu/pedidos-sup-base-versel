import { MONTHS } from "./months.js";

export function lineChart(canvas, points, color = "#2563eb") {
  const ctx = setup(canvas);
  if (!ctx) return;
  const { w, h } = canvas;
  const pad = 26;
  const max = Math.max(...points.map((p) => p.value), 1);
  grid(ctx, w, h, pad);
  const coords = points.map((point, index) => ({
    x: pad + (index / Math.max(points.length - 1, 1)) * (w - pad * 1.35),
    y: h - pad - (point.value / max) * (h - pad * 1.8),
  }));
  ctx.beginPath();
  coords.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, h - pad);
    ctx.lineTo(point.x, point.y);
  });
  const last = coords[coords.length - 1];
  if (last) ctx.lineTo(last.x, h - pad);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, pad, 0, h - pad);
  gradient.addColorStop(0, hexToRgba(color, 0.18));
  gradient.addColorStop(1, hexToRgba(color, 0.01));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  coords.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

export function barChart(canvas, items, color = "#0f766e") {
  const ctx = setup(canvas);
  if (!ctx) return;
  const { w, h } = canvas;
  const pad = 26;
  const max = Math.max(...items.map((i) => i.value), 1);
  grid(ctx, w, h, pad);
  const width = (w - pad * 1.8) / items.length;
  items.forEach((item, index) => {
    const barH = (item.value / max) * (h - pad * 1.8);
    const x = pad + index * width + width * 0.18;
    const y = h - pad - barH;
    ctx.fillStyle = item.color || color;
    roundRect(ctx, x, y, width * 0.64, barH, 5);
    ctx.fill();
    ctx.fillStyle = "#475569";
    ctx.font = "11px Manrope, Segoe UI";
    ctx.textAlign = "center";
    if (items.length <= 10 || index % 2 === 0) ctx.fillText(String(item.label).slice(0, 8), x + width * 0.32, h - 8);
  });
}

export function seasonalChart(canvas, items) {
  barChart(canvas, items.map((item, index) => ({
    label: MONTHS[index]?.label || item.month,
    value: item.value,
    color: index % 2 ? "#2563eb" : "#14b8a6",
  })));
}

export function forecastChart(canvas, actual, forecast) {
  const ctx = setup(canvas);
  if (!ctx) return;
  const { w, h } = canvas;
  const pad = 28;
  const combined = [...actual.map((item) => ({ ...item, type: "Real" })), ...forecast.map((item) => ({ ...item, type: "Previsao" }))];
  const max = Math.max(...combined.map((item) => item.value), 1);
  const points = combined.map((item, index) => ({
    ...item,
    x: pad + (index / Math.max(combined.length - 1, 1)) * (w - pad * 1.45),
    y: h - pad - (item.value / max) * (h - pad * 1.8),
  }));
  grid(ctx, w, h, pad);
  const splitX = points[actual.length - 1]?.x || pad;
  ctx.strokeStyle = "#d9e2ef";
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(splitX, pad - 4);
  ctx.lineTo(splitX, h - pad + 4);
  ctx.stroke();
  ctx.setLineDash([]);
  drawSeries(ctx, points.slice(0, actual.length), "#F28E26", false);
  drawSeries(ctx, points.slice(Math.max(actual.length - 1, 0)), "#476192", true);
  points.forEach((point) => {
    ctx.beginPath();
    ctx.fillStyle = point.type === "Real" ? "#F28E26" : "#476192";
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#64748b";
  ctx.font = "11px Manrope, Segoe UI";
  ctx.textAlign = "left";
  ctx.fillText("Real", pad, 14);
  ctx.fillText("Previsto", splitX + 8, 14);
  bindTooltip(canvas, points);
}

function drawSeries(ctx, points, color, dashed) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.setLineDash(dashed ? [5, 5] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function bindTooltip(canvas, points) {
  const tooltip = chartTooltip();
  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const nearest = points.reduce((best, point) => {
      const distance = Math.abs(point.x - x);
      return !best || distance < best.distance ? { point, distance } : best;
    }, null);
    if (!nearest || nearest.distance > 28) {
      tooltip.style.display = "none";
      return;
    }
    tooltip.innerHTML = `<strong>${nearest.point.label}</strong><br>${nearest.point.type}: ${Math.round(nearest.point.value).toLocaleString("pt-BR")}`;
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
    tooltip.style.display = "block";
  };
  canvas.onmouseleave = () => {
    tooltip.style.display = "none";
  };
}

function chartTooltip() {
  let tooltip = document.querySelector(".chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function setup(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(360, rect.width) * ratio;
  canvas.height = 140 * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  canvas.w = canvas.width / ratio;
  canvas.h = canvas.height / ratio;
  ctx.clearRect(0, 0, canvas.w, canvas.h);
  return ctx;
}

function grid(ctx, w, h, pad) {
  ctx.strokeStyle = "#edf1f6";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const y = pad + i * ((h - pad * 1.6) / 3);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - 16, y);
    ctx.stroke();
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
