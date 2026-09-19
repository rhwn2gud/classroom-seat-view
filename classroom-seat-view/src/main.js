import { store, nextDeskLabel, syncDeskCounter } from './state.js';
import { Editor2D } from './editor2d.js';
import { Scene3D } from './scene3d.js';
import { DESK_SIZE } from './types.js';

syncDeskCounter(store.getState().desks);

// ---------- 탭 전환 ----------
const tabButtons = document.querySelectorAll('.tab-btn');
const panels = {
  editor: document.getElementById('editor-tab'),
  preview: document.getElementById('preview-tab'),
};

/** @param {'editor'|'preview'} name */
function activateTab(name) {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  panels.editor.classList.toggle('active', name === 'editor');
  panels.preview.classList.toggle('active', name === 'preview');
  editor.resize();
  scene.setActive(name === 'preview');
  if (name === 'preview') scene.resize();
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// ---------- 2D 편집기 ----------
const editorCanvas = document.getElementById('editor-canvas');
const editor = new Editor2D(editorCanvas);

// ---------- 3D 미리보기 ----------
const previewCanvas = document.getElementById('preview-canvas');
const scene = new Scene3D(previewCanvas);

const scoreValueEl = document.getElementById('score-value');
const scoreLabelEl = document.getElementById('score-label');
scene.onScore = (result) => {
  if (!result) {
    scoreValueEl.textContent = '-';
    scoreLabelEl.textContent = '좌석을 선택하세요';
    return;
  }
  scoreValueEl.textContent = `${result.percent}%`;
  scoreLabelEl.textContent = result.label;
};

scene.init();

// ---------- 방/칠판 설정 입력 ----------
const widthInput = document.getElementById('room-width');
const depthInput = document.getElementById('room-depth');
const boardWidthInput = document.getElementById('board-width');

/** @param {import('./types.js').AppState} state */
function syncRoomInputs(state) {
  widthInput.value = String(state.room.width);
  depthInput.value = String(state.room.depth);
  boardWidthInput.value = String(state.room.boardWidth);
}
syncRoomInputs(store.getState());

widthInput.addEventListener('change', () => store.setRoom({ width: Number(widthInput.value) || 1 }));
depthInput.addEventListener('change', () => store.setRoom({ depth: Number(depthInput.value) || 1 }));
boardWidthInput.addEventListener('change', () => store.setRoom({ boardWidth: Number(boardWidthInput.value) || 1 }));

// ---------- 책상 추가/회전/삭제 ----------
const addDeskBtn = document.getElementById('add-desk-btn');
let addMode = false;
function setAddModeUI(on) {
  addMode = on;
  editor.setAddMode(on);
  addDeskBtn.textContent = on ? '👉 교실 안을 클릭하세요' : '➕ 책상 추가 (클릭해서 배치)';
}
addDeskBtn.addEventListener('click', () => setAddModeUI(!addMode));
window.addEventListener('desk-add-mode-off', () => setAddModeUI(false));

document.getElementById('rotate-desk-btn').addEventListener('click', () => {
  const ids = editor.getSelectedIds();
  if (ids.length === 0) return;
  const { desks } = store.getState();
  for (const id of ids) {
    const d = desks.find((x) => x.id === id);
    if (!d) continue;
    store.updateDesk(id, { rotation: (d.rotation + Math.PI / 2) % (Math.PI * 2) });
  }
});

document.getElementById('delete-desk-btn').addEventListener('click', () => {
  const ids = editor.getSelectedIds();
  if (ids.length === 0) return;
  for (const id of ids) store.removeDesk(id);
  editor.clearSelection();
});

// ---------- 격자로 자동 채우기 ----------
document.getElementById('grid-fill-btn').addEventListener('click', () => {
  const rows = Number(document.getElementById('grid-rows').value) || 1;
  const cols = Number(document.getElementById('grid-cols').value) || 1;
  const { room } = store.getState();

  const marginX = 0.6;
  const marginTop = 1.4; // 칠판과의 거리
  const marginBottom = 0.6;
  const usableW = room.width - marginX * 2;
  const usableD = room.depth - marginTop - marginBottom;
  const stepX = cols > 1 ? usableW / (cols - 1) : 0;
  const stepZ = rows > 1 ? usableD / (rows - 1) : 0;

  const desks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      desks.push({
        id: crypto.randomUUID(),
        x: cols > 1 ? marginX + stepX * c : room.width / 2,
        z: marginTop + (rows > 1 ? stepZ * r : 0),
        rotation: 0,
        label: nextDeskLabel(),
      });
    }
  }
  store.replaceDesks(desks);
});

// ---------- 짝지어 배치 (책상 2개씩 붙이기) ----------
document.getElementById('pair-fill-btn').addEventListener('click', () => {
  const groups = Math.max(1, Number(document.getElementById('pair-groups').value) || 1);
  const rows = Math.max(1, Number(document.getElementById('pair-rows').value) || 1);
  const { room } = store.getState();

  const tightGap = 0.05; // 붙어있는 책상 2개 사이 틈
  const aisleGap = 0.6; // 조와 조 사이 통로
  const marginTop = 1.4; // 칠판과의 거리
  const marginBottom = 0.6;

  const pairWidth = DESK_SIZE.width * 2 + tightGap;
  const totalWidth = pairWidth * groups + aisleGap * (groups - 1);
  const startX = (room.width - totalWidth) / 2 + DESK_SIZE.width / 2;

  const usableD = room.depth - marginTop - marginBottom;
  const stepZ = rows > 1 ? usableD / (rows - 1) : 0;

  const desks = [];
  for (let g = 0; g < groups; g++) {
    const groupX = startX + g * (pairWidth + aisleGap);
    const col0X = groupX;
    const col1X = groupX + DESK_SIZE.width + tightGap;
    for (let r = 0; r < rows; r++) {
      const z = marginTop + stepZ * r;
      for (const x of [col0X, col1X]) {
        desks.push({
          id: crypto.randomUUID(),
          x,
          z,
          rotation: 0,
          label: nextDeskLabel(),
        });
      }
    }
  }
  store.replaceDesks(desks);
});

// ---------- 내보내기 / 불러오기 / 초기화 ----------
document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify(store.getState(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'classroom-seating.json';
  a.click();
  URL.revokeObjectURL(url);
});

const importInput = document.getElementById('import-file');
document.getElementById('import-btn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.room || !Array.isArray(parsed.desks)) throw new Error('invalid');
    store.replaceAll(parsed);
    syncDeskCounter(parsed.desks);
    syncRoomInputs(parsed);
  } catch {
    alert('파일을 읽을 수 없어요. 이 프로그램에서 내보낸 JSON 파일인지 확인해주세요.');
  } finally {
    importInput.value = '';
  }
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('모든 자리 배치를 초기화할까요?')) return;
  store.reset();
  syncRoomInputs(store.getState());
});

// ---------- 좌석 목록 (미리보기 탭) ----------
const seatListEl = document.getElementById('seat-list');
/** @param {import('./types.js').AppState} state */
function renderSeatList(state) {
  seatListEl.innerHTML = '';
  if (state.desks.length === 0) {
    const li = document.createElement('li');
    li.textContent = '먼저 "배치 편집" 탭에서 책상을 추가하세요.';
    li.style.cursor = 'default';
    seatListEl.appendChild(li);
    return;
  }
  for (const d of state.desks) {
    const li = document.createElement('li');
    li.textContent = d.label;
    li.classList.toggle('selected', d.id === state.selectedDeskId);
    li.addEventListener('click', () => {
      store.select(d.id);
      scene.focusSeat(d.id);
    });
    seatListEl.appendChild(li);
  }
}

store.subscribe((state) => {
  syncRoomInputs(state);
  renderSeatList(state);
});
renderSeatList(store.getState());

// 초기 리사이즈
editor.resize();
scene.resize();
