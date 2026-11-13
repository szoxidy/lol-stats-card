// 动画随 SVG 独立工作，不需要主页运行脚本。背景静态纹理与动画层分开。
export function motionLayers(mode = 'subtle', { mini = false, background = 'ahri', headerHeight = 112 } = {}) {
  const selected = ['subtle', 'frames'].includes(mode) ? mode : 'static';
  if (selected === 'static') return { style: '', atmosphere: '', foreground: '' };
  const colors = { 'miss-fortune': ['#819bdb', '#bedcff'], ahri: ['#b7b0ff', '#bfe7fa'], yasuo: ['#aacac6', '#d2eaf7'], jinx: ['#db98d9', '#bcd8ff'] };
  const [accent, glow] = colors[background] || colors.ahri;
  const [anchorX, anchorY] = ({ 'miss-fortune': [518, 104], ahri: [278, 91], yasuo: [384, 75], jinx: [465, 57] })[background] || [278, 91];
  const motes = Array.from({ length: 3 }, (_, i) => {
    const x = 300 + (i * 37) % 240, y = 18 + (i * 23) % 90;
    return `<circle class="mote m${i}" cx="${x}" cy="${y}" r="${i % 3 === 0 ? 1.2 : .6}" fill="${i % 2 ? accent : glow}"/>`;
  }).join('');
  const frameStyle = selected === 'frames' ? '@keyframes film{0%,4.15%{opacity:1}4.17%,100%{opacity:0}}.film{opacity:0;animation:film 2s steps(1,end) infinite}.first-frame{opacity:1}' : '';
  const frames = selected === 'frames' ? Array.from({ length: 24 }, (_, frame) => {
    const phase = frame / 24 * Math.PI * 2;
    const ripple = 15 + 3 * Math.sin(phase), cx = anchorX + Math.cos(phase) * 1.4, cy = anchorY + Math.sin(phase) * 1.2;
    const tail = Array.from({ length: 4 }, (_, i) => {
      const theta = phase - i * .32;
      return `<circle cx="${(anchorX + Math.cos(theta) * (12 + i * 2)).toFixed(2)}" cy="${(anchorY + Math.sin(theta) * (6 + i)).toFixed(2)}" r="${(1.6 - i * .3).toFixed(1)}" fill="${glow}" opacity="${(.85 - i * .17).toFixed(2)}"/>`;
    }).join('');
    return `<g class="film ${frame === 0 ? 'first-frame' : ''}" style="animation-delay:-${frame / 12}s"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${ripple.toFixed(2)}" fill="url(#soul)"/>${tail}</g>`;
  }).join('') : '';
  const style = `<style>
    @keyframes breathe{0%,100%{opacity:.16}50%{opacity:.34}}
    @keyframes drift{0%,100%{transform:translate(0,0);opacity:.1}45%{opacity:.5}60%{transform:translate(-4px,-9px);opacity:.15}}
    .mist{animation:breathe 12s ease-in-out infinite}.mote{animation:drift 12s ease-in-out infinite}
    ${Array.from({ length: 3 }, (_, i) => `.m${i}{animation-delay:-${i * 4}s}`).join('')}
    ${frameStyle}
    @media(prefers-reduced-motion:reduce){.mist,.mote,.film{animation:none!important}.mote{opacity:.3}.film{opacity:0}.first-frame{opacity:1}}
  </style>`;
  return {
    style,
    atmosphere: `<defs><radialGradient id="mist"><stop stop-color="${accent}" stop-opacity=".45"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><radialGradient id="soul"><stop stop-color="#e3f8ff" stop-opacity=".9"/><stop offset=".2" stop-color="${glow}" stop-opacity=".6"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs><ellipse class="mist" cx="453" cy="69" rx="112" ry="62" fill="url(#mist)"/><g>${motes}${frames}</g>`,
    foreground: ''
  };
}
