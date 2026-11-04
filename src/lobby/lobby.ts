import { SNAIL_NAME_MAX, TEAM_NAME_MAX, type RoomView, type TeamEdit } from '../net/api';
import { listenToRoom } from '../net/live';
import { TEAM_PALETTE } from '../render/palette';
import { MAX_SNAILS_PER_TEAM, MAX_TEAMS } from '../sim/types';

/** What the game needs once the room's match has started. */
export interface Seat {
  roomId: string;
  token: string;
  teamIndex: number;
}

/**
 * The online lobby: create a room, or open one from its link, set up your team, confirm your
 * email, and (host) start the game. Calls `onStart` once the match is running and you have a team.
 */
export function showLobby(root: HTMLElement, roomId: string | null, onStart: (seat: Seat) => void): void {
  const params = new URLSearchParams(location.search);
  // ?seat=b keeps a separate token, so one browser can hold two players (for testing).
  const seat = params.get('seat');
  const tokenKey = (id: string) => `snails.player.${id}${seat ? `.${seat}` : ''}`;
  const getToken = (id: string): string | null => {
    try {
      return localStorage.getItem(tokenKey(id));
    } catch {
      return null;
    }
  };
  const saveToken = (id: string, token: string) => {
    try {
      localStorage.setItem(tokenKey(id), token);
    } catch {
      // Private mode: the seat lasts until the tab closes.
    }
  };

  async function api<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
    return data;
  }

  root.hidden = false;
  if (roomId) void openRoom(roomId);
  else showHome();

  function showHome(): void {
    root.replaceChildren(
      el('div', { class: 'card' }, [
        el('h1', {}, ['🐌 Snails online']),
        el('p', { class: 'muted' }, ['Make a room, send the link to friends (2–4 teams), and take turns whenever you like.']),
        field('Snails per team', select('snails', [1, 2, 3, 4].map((n) => [String(n), String(n)]), '3')),
        field('Time per turn', select('secs', [15, 30, 45, 60].map((n) => [String(n), `${n} s`]), '30')),
        button('Create room', 'primary', async (b) => {
          b.disabled = true;
          try {
            const r = await api<{ roomId: string; token: string }>('POST', '/api/rooms', {
              snailsPerTeam: Number(value('snails')),
              turnSeconds: Number(value('secs')),
            });
            saveToken(r.roomId, r.token);
            const q = new URLSearchParams(location.search);
            q.delete('online');
            q.set('room', r.roomId);
            history.replaceState(null, '', `?${q}`);
            void openRoom(r.roomId);
          } catch (e) {
            b.disabled = false;
            flash(e);
          }
        }),
        el('p', { class: 'muted small' }, [el('a', { href: '/' }, ['← Play on this device instead'])]),
      ]),
    );
  }

  async function openRoom(id: string): Promise<void> {
    let view: RoomView;
    let stop: (() => void) | null = null;
    /** The player's own team form; built once so typing is never lost to a live update. */
    let form: HTMLElement | null = null;
    let formSnails = 0;

    const load = async () => {
      try {
        view = await api<RoomView>('GET', `/api/rooms/${id}`, undefined, getToken(id));
      } catch (e) {
        root.replaceChildren(el('div', { class: 'card' }, [el('h1', {}, ['Room not found']), el('p', {}, [String((e as Error).message)])]));
        return;
      }
      const mine = view.you && view.teams.find((t) => t.playerId === view.you!.playerId);
      if (view.status !== 'lobby' && mine && mine.teamIndex !== null) {
        stop?.();
        root.hidden = true;
        onStart({ roomId: id, token: getToken(id)!, teamIndex: mine.teamIndex });
        return;
      }
      render();
    };

    function render(): void {
      const you = view.you;
      const link = `${location.origin}/?room=${id}`;
      const linkInput = el('input', { readonly: '', value: link, class: 'link' }) as HTMLInputElement;
      const sections: Node[] = [
        el('h1', {}, ['🐌 Room ', el('code', {}, [id])]),
        el('div', { class: 'row' }, [
          linkInput,
          button('Copy link', '', async (b) => {
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              linkInput.select();
              document.execCommand('copy');
            }
            b.textContent = 'Copied ✓';
            setTimeout(() => (b.textContent = 'Copy link'), 1500);
          }),
        ]),
        el('p', { class: 'muted small' }, [`Send this link to the other players. ${view.teams.length}/${MAX_TEAMS} teams.`]),
        teamList(),
      ];
      if (view.status !== 'lobby') {
        sections.push(el('p', {}, ['This game has already started, and you are not in it.']));
      } else if (!you) {
        sections.push(
          view.teams.length >= MAX_TEAMS
            ? el('p', {}, ['This room is full.'])
            : button('Join with a new team', 'primary', async (b) => {
                b.disabled = true;
                try {
                  const r = await api<{ token: string }>('POST', `/api/rooms/${id}/join`);
                  saveToken(id, r.token);
                  await load();
                } catch (e) {
                  b.disabled = false;
                  flash(e);
                }
              }),
        );
      } else {
        if (!form || formSnails !== view.snailsPerTeam) {
          form = teamForm();
          formSnails = view.snailsPerTeam;
        }
        refreshForm(form);
        sections.push(form);
        if (you.isHost) sections.push(hostPanel());
        else sections.push(el('p', { class: 'muted' }, ['Waiting for the host to start the game…']));
      }
      root.replaceChildren(el('div', { class: 'card' }, sections));
    }

    function teamList(): HTMLElement {
      return el(
        'ul',
        { class: 'teams' },
        view.teams.map((t) =>
          el('li', {}, [
            el('span', { class: 'dot', style: `background:${TEAM_PALETTE[t.color].main}` }),
            el('b', {}, [t.name]),
            t.isHost ? el('span', { class: 'tag' }, ['host']) : '',
            t.playerId === view.you?.playerId ? el('span', { class: 'tag you' }, ['you']) : '',
            el('span', { class: 'muted small' }, [t.snailNames.join(', ')]),
            el('span', { class: 'small' }, [t.verified ? '✉ ✓' : t.hasEmail ? '✉ pending' : '']),
          ]),
        ),
      );
    }

    function teamForm(): HTMLElement {
      const mine = view.teams.find((t) => t.playerId === view.you!.playerId)!;
      let color = mine.color;
      const swatches = el(
        'div',
        { class: 'swatches' },
        TEAM_PALETTE.map((c, i) => {
          const b = el('button', { type: 'button', class: 'swatch', title: c.name, style: `background:${c.main}`, 'data-color': String(i) });
          b.addEventListener('click', () => {
            color = i;
            mark();
          });
          return b;
        }),
      );
      const mark = () => {
        for (const b of swatches.querySelectorAll<HTMLButtonElement>('.swatch')) b.classList.toggle('on', Number(b.dataset.color) === color);
      };
      mark();
      const snailInputs = mine.snailNames.map((n, i) =>
        el('input', { value: n, maxlength: String(SNAIL_NAME_MAX), 'aria-label': `Snail ${i + 1}` }),
      ) as HTMLInputElement[];
      const nameInput = el('input', { value: mine.name, maxlength: String(TEAM_NAME_MAX) }) as HTMLInputElement;
      const emailInput = el('input', {
        type: 'email',
        value: view.you!.email ?? '',
        placeholder: 'you@example.com',
        autocomplete: 'email',
      }) as HTMLInputElement;
      const emailStatus = el('p', { class: 'small email-status' });
      const resend = button('Send the link again', 'small-btn', async (b) => {
        b.disabled = true;
        try {
          await api('POST', `/api/rooms/${id}/me/verify`, undefined, getToken(id));
          note('A new link is on its way.');
        } catch (e) {
          flash(e);
        } finally {
          b.disabled = false;
        }
      });
      resend.classList.add('resend');
      const save = button('Save team', 'primary', async (b) => {
        b.disabled = true;
        try {
          const edit: TeamEdit = {
            teamName: nameInput.value,
            color,
            snailNames: snailInputs.map((i) => i.value),
            email: emailInput.value.trim(),
          };
          const sentTo = edit.email && edit.email.toLowerCase() !== (view.you!.email ?? '') ? edit.email : null;
          view = await api<RoomView>('PATCH', `/api/rooms/${id}/me`, edit, getToken(id));
          note(sentTo ? `Saved. Check ${sentTo} for a link to confirm it.` : 'Saved.');
          render();
        } catch (e) {
          flash(e);
        } finally {
          b.disabled = false;
        }
      });
      return el('section', { class: 'mine' }, [
        el('h2', {}, ['Your team']),
        field('Team name', nameInput),
        field('Color', swatches),
        field(view.snailsPerTeam === 1 ? 'Snail' : 'Snails', el('div', { class: 'snails' }, snailInputs)),
        field('Email for “your move” messages (optional)', emailInput),
        emailStatus,
        resend,
        save,
      ]);
    }

    /** Live bits of the form: taken colors and the email's state. */
    function refreshForm(f: HTMLElement): void {
      const taken = new Set(view.teams.filter((t) => t.playerId !== view.you!.playerId).map((t) => t.color));
      for (const b of f.querySelectorAll<HTMLButtonElement>('.swatch')) {
        b.disabled = taken.has(Number(b.dataset.color));
      }
      const you = view.you!;
      const status = f.querySelector<HTMLElement>('.email-status')!;
      const resend = f.querySelector<HTMLElement>('.resend')!;
      status.textContent = !you.email
        ? 'We email you only when it is your move. Add one and confirm it.'
        : you.verified
          ? `✓ ${you.email} is confirmed. We will tell you when it is your move.`
          : `Check your inbox: click the link we sent to ${you.email} to confirm it. Until then we send nothing else.`;
      status.classList.toggle('ok', you.verified);
      resend.hidden = !you.email || you.verified;
    }

    function hostPanel(): HTMLElement {
      const snails = select('host-snails', [...Array(MAX_SNAILS_PER_TEAM).keys()].map((i) => [String(i + 1), String(i + 1)]), String(view.snailsPerTeam));
      const secs = select('host-secs', [15, 30, 45, 60].map((n) => [String(n), `${n} s`]), String(view.turnSeconds));
      const update = async () => {
        try {
          view = await api<RoomView>('PATCH', `/api/rooms/${id}`, { snailsPerTeam: Number(snails.value), turnSeconds: Number(secs.value) }, getToken(id));
          render();
        } catch (e) {
          flash(e);
        }
      };
      snails.addEventListener('change', update);
      secs.addEventListener('change', update);
      const enough = view.teams.length >= 2;
      const start = button(enough ? 'Start the game' : 'Start (needs 2+ teams)', 'primary', async (b) => {
        b.disabled = true;
        try {
          await api('POST', `/api/rooms/${id}/start`, undefined, getToken(id));
          await load();
        } catch (e) {
          b.disabled = false;
          flash(e);
        }
      });
      (start as HTMLButtonElement).disabled = !enough;
      return el('section', { class: 'host' }, [
        el('h2', {}, ['Game settings (host)']),
        el('div', { class: 'row' }, [field('Snails per team', snails), field('Time per turn', secs)]),
        start,
      ]);
    }

    await load();
    if (params.get('verified') === '1') note('Email confirmed ✓');
    stop = listenToRoom(id, () => void load());
  }

  // Small DOM helpers.
  function el(tag: string, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElement {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...children);
    return e;
  }
  function field(label: string, control: Node): HTMLElement {
    return el('label', { class: 'field' }, [el('span', {}, [label]), control]);
  }
  function select(id: string, options: [string, string][], value: string): HTMLSelectElement {
    const s = el('select', { id }, options.map(([v, t]) => el('option', { value: v }, [t]))) as HTMLSelectElement;
    s.value = value;
    return s;
  }
  function value(id: string): string {
    return (document.getElementById(id) as HTMLSelectElement).value;
  }
  function button(text: string, cls: string, onClick: (b: HTMLButtonElement) => void | Promise<void>): HTMLButtonElement {
    const b = el('button', { type: 'button', class: cls }, [text]) as HTMLButtonElement;
    b.addEventListener('click', () => void onClick(b));
    return b;
  }
  function note(text: string, error = false): void {
    const n = el('div', { class: `toast${error ? ' err' : ''}`, role: 'status' }, [text]);
    document.body.append(n);
    setTimeout(() => n.remove(), 4000);
  }
  function flash(e: unknown): void {
    note(e instanceof Error ? e.message : String(e), true);
  }
}
