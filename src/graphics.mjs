export function levelBadge(level, x, y, radius = 16) {
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (index * 60 - 90) / 180 * Math.PI;
    return `${(x + Math.cos(angle) * radius).toFixed(2)},${(y + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ');
  return `<g><title>账号等级${level ?? '待更新'}</title><polygon points="${points}" fill="#342b34" stroke="#d9c265" stroke-width="1.1"/><text x="${x}" y="${y + 4}" fill="#fbf1d6" font-size="${radius < 16 || level > 999 ? 9 : 11}" text-anchor="middle">${level ?? '—'}</text></g>`;
}
