import type { GameState } from '../sim/types';

/** The 8 team colors a lobby can pick from: label color and the shell's light and dark tones. */
export const TEAM_PALETTE: readonly { name: string; main: string; light: string; dark: string }[] = [
  { name: 'Orange', main: '#ff8a3d', light: '#ffb36b', dark: '#c4571c' },
  { name: 'Blue', main: '#5ec8ff', light: '#9fe0ff', dark: '#2a7fb8' },
  { name: 'Green', main: '#7ddc5a', light: '#b4f08f', dark: '#3c8a2a' },
  { name: 'Pink', main: '#ff6fae', light: '#ffa8cf', dark: '#b8306e' },
  { name: 'Yellow', main: '#ffd23f', light: '#ffe68a', dark: '#b08a10' },
  { name: 'Purple', main: '#b38cff', light: '#d4bfff', dark: '#6a45b8' },
  { name: 'Red', main: '#ff5a5a', light: '#ff9a9a', dark: '#b02a2a' },
  { name: 'Teal', main: '#3fe0c5', light: '#93f0e0', dark: '#1f8f7c' },
];

export function teamPalette(state: GameState, team: number) {
  return TEAM_PALETTE[state.teams[team]?.color ?? team] ?? TEAM_PALETTE[0];
}

/** A team's label color. */
export function teamColor(state: GameState, team: number): string {
  return teamPalette(state, team).main;
}
