// 이 파일은 타입 대신 공용 상수를 모아둡니다 (빌드 도구 없이 순수 JS로 동작).

/**
 * @typedef {Object} Desk
 * @property {string} id
 * @property {number} x - 방 안에서의 x좌표 (m). 0 = 왼쪽 벽
 * @property {number} z - 방 안에서의 z좌표 (m). 0 = 칠판이 있는 앞쪽 벽
 * @property {number} rotation - 라디안. 0 = 칠판(앞쪽, -z 방향)을 바라봄
 * @property {string} label
 */

/**
 * @typedef {Object} RoomConfig
 * @property {number} width
 * @property {number} depth
 * @property {number} boardWidth
 */

/**
 * @typedef {Object} AppState
 * @property {RoomConfig} room
 * @property {Desk[]} desks
 * @property {string|null} selectedDeskId
 */

export const DESK_SIZE = { width: 0.65, depth: 0.51 }; // 실제 책상 모델(desk.glb) 기준
export const CHAIR_SIZE = { width: 0.41, depth: 0.51 }; // 실제 의자 모델(chair.glb) 기준
export const EYE_HEIGHT = 1.15; // 앉은 상태 평균 눈높이 (m)
export const BOARD_HEIGHT = 1.34; // 칠판 세로 길이 (m) - 실제 교실 모델 기준
export const BOARD_BOTTOM = 0.85; // 칠판 하단이 바닥에서 떨어진 높이 (m) - 실제 교실 모델 기준
