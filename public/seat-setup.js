import { pick } from './i18n.js';

// Match the initial table view, grouping partners without reordering saved seats.
export function setupSeatRows(seats) {
  const human = seats.findIndex((seat) => seat.kind === 'human');
  const viewer = Math.max(0, human);
  const roles = [
    {
      offset: 0,
      position: 'south',
      marker: '↓',
      label: pick('你', 'You'),
      hint: pick('下方 · 我方', 'Bottom · your team'),
    },
    {
      offset: 2,
      position: 'north',
      marker: '↑',
      label: pick('队友（对家）', 'Teammate'),
      hint: pick('对面 · 我方', 'Across · your team'),
    },
    {
      offset: 3,
      position: 'west',
      marker: '←',
      label: pick('上家对手', 'Left opponent'),
      hint: pick('左侧 · 对方', 'Left · opposing team'),
    },
    {
      offset: 1,
      position: 'east',
      marker: '→',
      label: pick('下家对手', 'Right opponent'),
      hint: pick('右侧 · 对方', 'Right · opposing team'),
    },
  ];
  return roles.map(({ offset, ...role }) => ({
    ...role,
    index: (viewer + offset) % 4,
    team: offset % 2,
    ...(human < 0
      ? {
          label: offset % 2 ? pick('队伍二', 'Team two') : pick('队伍一', 'Team one'),
          hint: pick(
            { south: '下方', north: '对面', west: '左侧', east: '右侧' }[role.position],
            { south: 'Bottom', north: 'Across', west: 'Left', east: 'Right' }[role.position],
          ),
        }
      : {}),
  }));
}
