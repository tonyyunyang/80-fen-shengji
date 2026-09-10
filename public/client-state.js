// A response belongs to the requested player and one server session. Revisions
// from a previous session cannot order a restored game's new snapshots.
export function acceptSnapshot(previous, next, viewer, request = null) {
  if (request && (request.viewer !== viewer || request.csrf !== (previous?.csrf || ''))) return false;
  // The server projects bot seats and unassigned viewers as spectators.
  const expectedViewer = next.game?.seats && next.game.seats[viewer]?.kind !== 'human' ? -1 : viewer;
  if (next.game && next.game.viewer !== expectedViewer) return false;
  if (!previous || next.csrf !== previous.csrf) return true;
  if (next.revision < previous.revision) return false;

  const before = previous.game,
    after = next.game;
  return !(
    before &&
    after &&
    before.id === after.id &&
    before.viewer === after.viewer &&
    after.version < before.version
  );
}

export function isHumanTurn(game, viewer) {
  return game?.viewer === viewer && game?.pending?.seat === viewer && game?.seats?.[viewer]?.kind === 'human';
}
