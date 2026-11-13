const $ = selector => document.querySelector(selector);
let theme = 'dark', state = null;
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };

function updateCard() {
  const previewRevision = Date.now().toString(36);
  const layout = $('#layout').value;
  const params = new URLSearchParams({ layout, theme, background: $('#background').value, motion: $('#motion').value, queue: $('#queue').value });
  const address = new URL(`/card.svg?${params}`, location.origin).href;
  $('.card-stage').setAttribute('aria-busy', 'true');
  $('#card').src = `${address}&v=${encodeURIComponent(state?.current?.syncedAt || 'initial')}&preview=${previewRevision}`;
  $('#card').classList.toggle('wide', layout === 'wide');
  $('.card-stage').classList.toggle('compact', layout === 'compact');
  $('#card').width = layout === 'wide' ? 550 : 400;
  $('#card').height = layout === 'wide' ? 320 : 120;
  $('#download').href = `${address}&download=1`;
  $('#embed-code').textContent = `![英雄联盟个人卡片](${address})`;
  $('#dimensions').textContent = layout === 'wide' ? '550 × 320' : '400 × 120';
  $('#motion-label').textContent = $('#motion').selectedOptions[0].textContent;
  $('#source-label').textContent = state?.current?.profile ? '已保存的资料' : '等待首次更新';
  $('#copy').dataset.address = address;
}

async function load() {
  try {
    const response = await fetch('/api/profile');
    if (!response.ok) throw new Error('本地资料读取失败，请刷新页面后重试。');
    state = await response.json();
    const player = state.current.profile || state.player;
    $('#player-name').textContent = `${player.name}${player.tag ? `#${player.tag}` : ''}`;
    $('#player-region').textContent = player.region === 'HN1' ? '艾欧尼亚' : player.region;
    $('.local-label').textContent = `${state.region}预览`;
    status(state.current.profile ? '正在展示已保存的资料。免客户端自动更新尚未接通，刷新预览不会重新取数。' : '昵称和区服已确认。免客户端的远程数据来源尚未接通，卡片暂不显示战绩数值。');
    updateCard();
  } catch (error) { status(error.message, true); updateCard(); }
}

$('#layout').addEventListener('change', updateCard);
$('#card').addEventListener('load', () => $('.card-stage').setAttribute('aria-busy', 'false'));
$('#card').addEventListener('error', () => {
  $('.card-stage').setAttribute('aria-busy', 'false');
  status('卡片未能加载，请刷新预览重试。', true);
});
$('#background').addEventListener('change', updateCard);
$('#queue').addEventListener('change', updateCard);
$('#motion').addEventListener('change', updateCard);
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
  theme = button.dataset.theme;
  document.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  updateCard();
}));
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#copy').dataset.address); status('本地图片地址已复制。当前地址仅在这台电脑上可用。'); }
  catch { status('浏览器未允许复制，可以从下方引用代码中选取图片地址。', true); }
});
$('#refresh').addEventListener('click', async () => {
  const button = $('#refresh'); button.disabled = true;
  try { await load(); }
  finally { button.disabled = false; }
});
load();
