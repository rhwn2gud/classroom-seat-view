import { store, nextDeskLabel } from './state.js';
import { DESK_SIZE, CHAIR_SIZE } from './types.js';

const PADDING = 40; // px, 캔버스 여백

export class Editor2D {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D 캔버스를 초기화할 수 없습니다.');
    this.ctx = ctx;

    this.scale = 50; // px per meter, resize()에서 재계산
    this.addMode = false;

    // 여러 책상을 한번에 선택해서 같이 옮기기 위한 상태
    this.selectedIds = new Set();
    this.dragging = false;
    this.dragStart = { x: 0, z: 0 };
    this.dragOriginal = null; // Map<id, {x,z}> - 드래그 시작 시점의 원래 좌표들

    // 빈 곳을 드래그하면 사각형으로 여러 책상을 한번에 선택(마퀴 선택)
    this.marqueeActive = false;
    this.marqueeStart = null;
    this.marqueeEnd = null;

    window.addEventListener('resize', () => this.resize());
    this.resize();

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => this.onPointerUp());

    store.subscribe(() => this.render());
    this.render();
  }

  /** @param {boolean} on */
  setAddMode(on) {
    this.addMode = on;
    this.canvas.style.cursor = on ? 'copy' : 'default';
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  roomOrigin() {
    const { room } = store.getState();
    const cssW = this.canvas.width / (window.devicePixelRatio || 1);
    const cssH = this.canvas.height / (window.devicePixelRatio || 1);
    const availW = cssW - PADDING * 2;
    const availH = cssH - PADDING * 2;
    this.scale = Math.max(10, Math.min(availW / room.width, availH / room.depth));
    const roomPxW = room.width * this.scale;
    const roomPxH = room.depth * this.scale;
    const ox = (cssW - roomPxW) / 2;
    const oy = (cssH - roomPxH) / 2;
    return { ox, oy };
  }

  toRoomCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { ox, oy } = this.roomOrigin();
    const px = clientX - rect.left - ox;
    const py = clientY - rect.top - oy;
    return { x: px / this.scale, z: py / this.scale };
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {import('./types.js').Desk|null}
   */
  hitTestDesk(x, z) {
    const { desks } = store.getState();
    for (let i = desks.length - 1; i >= 0; i--) {
      const d = desks[i];
      const dx = x - d.x;
      const dz = z - d.z;
      const cos = Math.cos(-d.rotation);
      const sin = Math.sin(-d.rotation);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const halfW = DESK_SIZE.width / 2 + 0.15;
      const halfD = (DESK_SIZE.depth + CHAIR_SIZE.depth) / 2 + 0.15;
      if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfD) return d;
    }
    return null;
  }

  /** @returns {string[]} 현재 선택된 책상 id 목록 */
  getSelectedIds() {
    return Array.from(this.selectedIds);
  }

  clearSelection() {
    this.selectedIds = new Set();
    this.render();
  }

  /** @param {PointerEvent} e */
  onPointerDown(e) {
    const { x, z } = this.toRoomCoords(e.clientX, e.clientY);
    const hit = this.hitTestDesk(x, z);

    if (this.addMode) {
      const { room } = store.getState();
      const desk = {
        id: crypto.randomUUID(),
        x: Math.min(Math.max(x, 0.4), room.width - 0.4),
        z: Math.min(Math.max(z, 0.6), room.depth - 0.4),
        rotation: 0,
        label: nextDeskLabel(),
      };
      store.addDesk(desk);
      this.setAddMode(false);
      window.dispatchEvent(new CustomEvent('desk-add-mode-off'));
      return;
    }

    if (hit) {
      // 이미 여러 개가 선택된 상태에서 그 중 하나를 누르면 선택된 것들을 다 같이 옮깁니다.
      // 그 외에는(선택 안 된 책상을 누르거나, 단일 선택 상태) 그 책상 하나만 선택합니다.
      if (!(this.selectedIds.has(hit.id) && this.selectedIds.size > 1)) {
        this.selectedIds = new Set([hit.id]);
        store.select(hit.id);
      }

      const { desks } = store.getState();
      this.dragOriginal = new Map();
      for (const id of this.selectedIds) {
        const d = desks.find((dd) => dd.id === id);
        if (d) this.dragOriginal.set(id, { x: d.x, z: d.z });
      }
      this.dragging = true;
      this.dragStart = { x, z };
    } else {
      // 빈 곳을 누르면 드래그해서 사각형으로 여러 책상을 한번에 선택할 수 있습니다.
      this.selectedIds = new Set();
      store.select(null);
      this.marqueeActive = true;
      this.marqueeStart = { x, z };
      this.marqueeEnd = { x, z };
    }
    this.render();
  }

  /** @param {PointerEvent} e */
  onPointerMove(e) {
    const { x, z } = this.toRoomCoords(e.clientX, e.clientY);

    if (this.dragging && this.dragOriginal) {
      const { room } = store.getState();
      const dx = x - this.dragStart.x;
      const dz = z - this.dragStart.z;
      for (const [id, orig] of this.dragOriginal) {
        const nx = Math.min(Math.max(orig.x + dx, 0.35), room.width - 0.35);
        const nz = Math.min(Math.max(orig.z + dz, 0.5), room.depth - 0.35);
        store.updateDesk(id, { x: nx, z: nz });
      }
      return;
    }

    if (this.marqueeActive) {
      this.marqueeEnd = { x, z };
      this.render();
    }
  }

  onPointerUp() {
    if (this.marqueeActive) {
      const x0 = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
      const x1 = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
      const z0 = Math.min(this.marqueeStart.z, this.marqueeEnd.z);
      const z1 = Math.max(this.marqueeStart.z, this.marqueeEnd.z);
      const MIN_DRAG = 0.05; // m, 이보다 작으면 그냥 빈 곳 클릭한 것으로 취급
      if (x1 - x0 > MIN_DRAG || z1 - z0 > MIN_DRAG) {
        const { desks } = store.getState();
        const found = desks.filter((d) => d.x >= x0 && d.x <= x1 && d.z >= z0 && d.z <= z1).map((d) => d.id);
        this.selectedIds = new Set(found);
        store.select(found.length === 1 ? found[0] : null);
      }
      this.marqueeActive = false;
      this.marqueeStart = null;
      this.marqueeEnd = null;
    }
    this.dragging = false;
    this.dragOriginal = null;
    this.render();
  }

  render() {
    const { room, desks } = store.getState();
    const ctx = this.ctx;

    // 삭제된 책상의 id가 선택 목록에 남아있지 않도록 정리
    const validIds = new Set(desks.map((d) => d.id));
    for (const id of this.selectedIds) {
      if (!validIds.has(id)) this.selectedIds.delete(id);
    }
    const cssW = this.canvas.width / (window.devicePixelRatio || 1);
    const cssH = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, cssW, cssH);

    const { ox, oy } = this.roomOrigin();
    ctx.save();
    ctx.translate(ox, oy);

    // 바닥
    ctx.fillStyle = '#14161f';
    ctx.strokeStyle = 'rgba(124, 107, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(0, 0, room.width * this.scale, room.depth * this.scale);
    ctx.strokeRect(0, 0, room.width * this.scale, room.depth * this.scale);

    // 격자
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let gx = 1; gx < room.width; gx++) {
      ctx.beginPath();
      ctx.moveTo(gx * this.scale, 0);
      ctx.lineTo(gx * this.scale, room.depth * this.scale);
      ctx.stroke();
    }
    for (let gz = 1; gz < room.depth; gz++) {
      ctx.beginPath();
      ctx.moveTo(0, gz * this.scale);
      ctx.lineTo(room.width * this.scale, gz * this.scale);
      ctx.stroke();
    }

    // 칠판 (앞쪽 벽 중앙)
    const boardPxW = room.boardWidth * this.scale;
    const boardX = (room.width * this.scale - boardPxW) / 2;
    const boardGrad = ctx.createLinearGradient(boardX, 0, boardX + boardPxW, 0);
    boardGrad.addColorStop(0, '#e8c37a');
    boardGrad.addColorStop(1, '#f5d9a0');
    ctx.fillStyle = boardGrad;
    ctx.fillRect(boardX, -6, boardPxW, 10);
    ctx.fillStyle = '#8a8ea3';
    ctx.font = '600 12px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('칠판 / 스크린', (room.width * this.scale) / 2, -14);

    // 책상들
    for (const d of desks) {
      ctx.save();
      ctx.translate(d.x * this.scale, d.z * this.scale);
      ctx.rotate(d.rotation);

      const deskW = DESK_SIZE.width * this.scale;
      const deskD = DESK_SIZE.depth * this.scale;
      const chairW = CHAIR_SIZE.width * this.scale;
      const chairD = CHAIR_SIZE.depth * this.scale;
      const isSelected = this.selectedIds.has(d.id);

      // 의자 (책상 뒤, +z 쪽 = 칠판 반대 방향)
      ctx.fillStyle = isSelected ? '#7c6bff' : '#3a3f56';
      ctx.fillRect(-chairW / 2, deskD / 2, chairW, chairD);

      // 책상
      ctx.fillStyle = isSelected ? '#c3baff' : '#d7e2ec';
      ctx.strokeStyle = isSelected ? '#7c6bff' : 'rgba(0,0,0,0.25)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.fillRect(-deskW / 2, -deskD / 2, deskW, deskD);
      ctx.strokeRect(-deskW / 2, -deskD / 2, deskW, deskD);

      // 칠판을 바라보는 방향 화살표(책상 앞쪽, -z)
      ctx.fillStyle = '#0d1320';
      ctx.beginPath();
      ctx.moveTo(0, -deskD / 2 - 6);
      ctx.lineTo(-5, -deskD / 2 + 2);
      ctx.lineTo(5, -deskD / 2 + 2);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      ctx.fillStyle = '#e8ecf6';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, d.x * this.scale, d.z * this.scale + 3);
    }

    // 드래그로 여러 책상 선택하는 중이면 사각형 표시
    if (this.marqueeActive && this.marqueeStart && this.marqueeEnd) {
      const x0 = Math.min(this.marqueeStart.x, this.marqueeEnd.x) * this.scale;
      const x1 = Math.max(this.marqueeStart.x, this.marqueeEnd.x) * this.scale;
      const z0 = Math.min(this.marqueeStart.z, this.marqueeEnd.z) * this.scale;
      const z1 = Math.max(this.marqueeStart.z, this.marqueeEnd.z) * this.scale;
      ctx.fillStyle = 'rgba(124, 107, 255, 0.15)';
      ctx.strokeStyle = 'rgba(124, 107, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      ctx.strokeRect(x0, z0, x1 - x0, z1 - z0);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}
