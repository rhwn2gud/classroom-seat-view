const STORAGE_KEY = 'classroom-seat-view:v1';

/** @returns {import('./types.js').AppState} */
function defaultState() {
  return {
    room: { width: 7.2, depth: 7.6, boardWidth: 5.3 },
    desks: [],
    selectedDeskId: null,
  };
}

/** @returns {import('./types.js').AppState} */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.room || !Array.isArray(parsed.desks)) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

class Store {
  constructor() {
    /** @type {import('./types.js').AppState} */
    this.state = load();
    /** @type {Array<(state: import('./types.js').AppState) => void>} */
    this.listeners = [];
  }

  getState() {
    return this.state;
  }

  /** @param {(state: import('./types.js').AppState) => void} fn */
  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit() {
    this.persist();
    for (const l of this.listeners) l(this.state);
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // localStorage를 쓸 수 없는 환경(비공개 모드 등)이면 조용히 무시합니다.
    }
  }

  /** @param {Partial<import('./types.js').RoomConfig>} patch */
  setRoom(patch) {
    this.state = { ...this.state, room: { ...this.state.room, ...patch } };
    this.emit();
  }

  /** @param {import('./types.js').Desk} desk */
  addDesk(desk) {
    this.state = { ...this.state, desks: [...this.state.desks, desk], selectedDeskId: desk.id };
    this.emit();
  }

  /**
   * @param {string} id
   * @param {Partial<import('./types.js').Desk>} patch
   */
  updateDesk(id, patch) {
    this.state = {
      ...this.state,
      desks: this.state.desks.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    };
    this.emit();
  }

  /** @param {string} id */
  removeDesk(id) {
    this.state = {
      ...this.state,
      desks: this.state.desks.filter((d) => d.id !== id),
      selectedDeskId: this.state.selectedDeskId === id ? null : this.state.selectedDeskId,
    };
    this.emit();
  }

  /** @param {string|null} id */
  select(id) {
    this.state = { ...this.state, selectedDeskId: id };
    this.emit();
  }

  /** @param {import('./types.js').Desk[]} desks */
  replaceDesks(desks) {
    this.state = { ...this.state, desks, selectedDeskId: null };
    this.emit();
  }

  /** @param {import('./types.js').AppState} next */
  replaceAll(next) {
    this.state = next;
    this.emit();
  }

  reset() {
    this.state = defaultState();
    this.emit();
  }
}

export const store = new Store();

let deskCounter = 1;
export function nextDeskLabel() {
  return `${deskCounter++}번`;
}

/** @param {import('./types.js').Desk[]} desks */
export function syncDeskCounter(desks) {
  deskCounter = desks.length + 1;
}
