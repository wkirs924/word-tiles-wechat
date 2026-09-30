/** DTO definitions are not a substitute for runtime validation of unknown input. */
export const PROTOCOL = 'word-tiles-wx/1' as const;
type Envelope = {protocol: typeof PROTOCOL; room_id: string; command_id: string};
type Turn = {round_id: string; turn_id: number};
export type PlayerCommand = Envelope & (
  | {type: 'REQUEST_START_ROUND'; payload: {preset_id: string; allow_extra_round?: boolean}}
  | (Turn & {type: 'DRAW_TILE'; payload: Record<string, never>})
  | (Turn & {type: 'DISCARD_TILE'; payload: {tile_id: string}})
  | (Turn & {type: 'PROPOSE_SENTENCE'; payload: {tile_ids: string[]; resource_keys?: string[]; reading_choices?: ({tone: 1|2|3|4}|null)[]}})
  | {type: 'SUBMIT_VOTE'; round_id: string; proposal_id: string; payload: {approve: boolean; rating: 0|1|2|3}}
  | {type: 'REQUEST_END_ROUND'; round_id: string; payload: Record<string, never>}
);
export interface Receipt {command_id: string; ok: boolean; error: string; revision: number; event_ids: string[]}
export interface ContentIdentity {content_version: string; rules_version: 'word-tiles-4'}
// No actor, seed, wall, scores or complete authoritative state in PlayerCommand.
