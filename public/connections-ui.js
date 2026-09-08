import { escapeHtml as escape } from './dom.js';
const option = (id, label, selected) => '<option value="' + escape(id) + '"' + (id === selected ? ' selected' : '') + '>' + escape(label) + '</option>';
export const connectionFor = (seat, profiles = []) => profiles.find(p => p.id === (seat.connectionId || ({ qwen: 'alibaba', openai: 'openai', claude: 'anthropic' })[seat.provider]));
const price = model => model.input != null && model.output != null ? '$' + Number(model.input).toFixed(2) + ' / $' + Number(model.output).toFixed(2) : '未填参考价';
export function apiSeatFields(seat, index, profiles) {
  const profile = connectionFor(seat, profiles), current = seat.provider === 'mock' ? 'mock' : profile?.id;
  return '<div class="provider-options"><label for="provider-' + index + '">API 连接 / 套餐</label><select id="provider-' + index + '" aria-label="座位 ' + index + ' API 连接">' +
    option('mock', '离线模拟 · 不调用模型', current) + profiles.map(p => option(p.id, p.name + (p.active ? ' · 已启用' : ' · 未填 key'), current)).join('') + '</select>' +
    (seat.provider === 'mock' ? '' : '<label class="model-label" for="model-' + index + '">模型 · 输入 / 输出 USD / 百万 tokens</label><select id="model-' + index + '" aria-label="座位 ' + index + ' 模型">' +
      (!profile?.models.some(m => m.id === seat.model) ? '<option value="" disabled selected>请先添加 / 选择模型</option>' : '') +
      (profile?.models || []).map(m => option(m.id, m.label + ' · ' + price(m), seat.model)).join('') + '</select>' +
      '<small class="connection-note">' + (profile?.active ? '自己的 key · 价格仅作参考' : '未启用时由陪练代打，零 API 请求') + '</small>') + '</div>';
}

export function setupConnectionsDialog({ state, post, refresh, notify }) {
  const $ = id => document.getElementById(id);
  let editing = 'alibaba';
  const tell = message => { $('connectionStatus').textContent = message; notify(message); };
  function list() {
    $('connectionList').innerHTML = (state()?.connections || []).map(p => '<button type="button" data-connection="' + p.id + '" class="connection-choice' + (p.id === editing ? ' selected' : '') + '"><span>' + escape(p.name) + '</span><small>' + (p.active ? '已启用' : '未填 key') + '</small></button>').join('');
    document.querySelectorAll('[data-connection]').forEach(button => button.onclick = () => edit(button.dataset.connection));
  }
  function edit(id) {
    editing = id;
    const p = state()?.connections?.find(item => item.id === id);
    $('connectionName').value = p?.name || '自定义连接';
    $('connectionProtocol').value = p?.provider || 'qwen';
    $('connectionUrl').value = p?.baseUrl || '';
    $('connectionModels').value = (p?.models || []).map(m => m.id + (m.input != null || m.output != null ? ' | ' + (m.input ?? '') + ' | ' + (m.output ?? '') : '')).join('\n');
    $('connectionKey').value = '';
    $('connectionStatus').textContent = '';
    $('connectionKey').placeholder = p?.active ? '已启用；留空保留原 key' : '粘贴你自己的 API key';
    $('forgetConnection').disabled = !p?.active;
    $('deleteConnection').hidden = !p || ['alibaba', 'openai', 'anthropic'].includes(p.id);
    list();
  }
  function open(id = 'alibaba') { edit(id); $('connectionsDialog').showModal(); }
  $('connectionsButton').onclick = () => open();
  $('closeConnections').onclick = () => $('connectionsDialog').close();
  $('newConnection').onclick = () => edit(null);
  $('connectionsDialog').addEventListener('close', () => { $('connectionKey').value = ''; });
  window.addEventListener('pagehide', () => { $('connectionKey').value = ''; });
  $('connectionForm').onsubmit = async event => {
    event.preventDefault();
    const key = $('connectionKey').value.trim();
    if (key && location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      $('connectionKey').value = ''; tell('请通过 HTTPS 或本机地址配置密钥'); return;
    }
    const models = $('connectionModels').value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [id, input, output] = line.split('|').map(v => v.trim());
      return { id, input: input || null, output: output || null };
    });
    $('saveConnection').disabled = true;
    try {
      const previous = new Set((state()?.connections || []).map(p => p.id));
      await post('connections/save', { id: editing, name: $('connectionName').value, provider: $('connectionProtocol').value,
        baseUrl: $('connectionUrl').value, models, key });
      await refresh();
      editing ||= state()?.connections.find(p => !previous.has(p.id))?.id;
      edit(editing);
      tell(key ? '已启用，将在下次决策时连接模型；没有自动发起付费测试。' : '连接设置已保存。');
    } catch (error) { tell(error.message); }
    finally { $('connectionKey').value = ''; $('saveConnection').disabled = false; }
  };
  $('forgetConnection').onclick = async () => {
    try { await post('connections/forget', { id: editing }); await refresh(); edit(editing); tell('这条连接的 key 已从服务端内存清除。'); }
    catch (error) { tell(error.message); }
  };
  $('deleteConnection').onclick = async () => {
    try { await post('connections/delete', { id: editing }); await refresh(); edit('alibaba'); }
    catch (error) { tell(error.message); }
  };
  $('forgetAllKeys').onclick = async () => {
    try { await post('connections/forget', {}); await refresh(); edit(editing); tell('所有 key 已清除。'); }
    catch (error) { tell(error.message); }
  };
  return { open };
}
