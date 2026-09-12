CREATE TABLE IF NOT EXISTS completed_games (
  result_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  deal_epoch INTEGER NOT NULL CHECK (deal_epoch > 0),
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  completed_at INTEGER NOT NULL,
  is_complete INTEGER NOT NULL DEFAULT 1 CHECK (is_complete = 1),
  winning_team INTEGER NOT NULL CHECK (winning_team IN (0, 1)),
  dealer INTEGER NOT NULL CHECK (dealer BETWEEN 0 AND 3),
  attackers_win INTEGER NOT NULL CHECK (attackers_win IN (0, 1)),
  final_attack_points INTEGER NOT NULL CHECK (final_attack_points >= 0),
  ruleset TEXT NOT NULL,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  trump_json TEXT NOT NULL CHECK (json_valid(trump_json)),
  levels_before_json TEXT NOT NULL CHECK (json_valid(levels_before_json)),
  levels_after_json TEXT NOT NULL CHECK (json_valid(levels_after_json)),
  seats_json TEXT NOT NULL CHECK (json_valid(seats_json)),
  action_sources_json TEXT NOT NULL CHECK (json_valid(action_sources_json)),
  replay_json TEXT NOT NULL CHECK (json_valid(replay_json) AND length(CAST(replay_json AS BLOB)) <= 131072),
  ip_address TEXT NOT NULL DEFAULT 'none',
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  UNIQUE (game_id, deal_epoch),
  CHECK (winning_team = CASE WHEN attackers_win = 1 THEN 1 - (dealer % 2) ELSE dealer % 2 END)
);
CREATE INDEX IF NOT EXISTS completed_games_user_time ON completed_games(user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS completed_games_time ON completed_games(completed_at);
CREATE INDEX IF NOT EXISTS completed_games_ip_retention ON completed_games(completed_at) WHERE ip_address <> 'none';
