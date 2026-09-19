import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DESK_SIZE, CHAIR_SIZE } from './types.js';

const loader = new GLTFLoader();

// 이 모듈 파일(src/models.js) 기준 상대 경로로 models 폴더를 찾습니다.
// GitHub Pages의 프로젝트 하위 경로(예: /classroom-seat-view/)에서도 항상 올바르게 동작합니다.
const MODELS_BASE = new URL('../models/', import.meta.url);

function placeholderDesk() {
  const group = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(DESK_SIZE.width, 0.05, DESK_SIZE.depth),
    new THREE.MeshStandardMaterial({ color: 0xd7e2ec }),
  );
  top.position.y = 0.72;
  top.castShadow = true;
  group.add(top);
  const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xb9c1cc });
  const offsets = [
    [DESK_SIZE.width / 2 - 0.03, DESK_SIZE.depth / 2 - 0.03],
    [-(DESK_SIZE.width / 2 - 0.03), DESK_SIZE.depth / 2 - 0.03],
    [DESK_SIZE.width / 2 - 0.03, -(DESK_SIZE.depth / 2 - 0.03)],
    [-(DESK_SIZE.width / 2 - 0.03), -(DESK_SIZE.depth / 2 - 0.03)],
  ];
  for (const [ox, oz] of offsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(ox, 0.36, oz);
    group.add(leg);
  }
  return group;
}

function placeholderChair() {
  const group = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1f3a63 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(CHAIR_SIZE.width, 0.04, CHAIR_SIZE.depth), seatMat);
  seat.position.y = 0.45;
  group.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(CHAIR_SIZE.width, 0.45, 0.04), seatMat);
  back.position.set(0, 0.67, CHAIR_SIZE.depth / 2 - 0.02);
  group.add(back);
  const legGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x333d55 });
  const offsets = [
    [CHAIR_SIZE.width / 2 - 0.02, CHAIR_SIZE.depth / 2 - 0.02],
    [-(CHAIR_SIZE.width / 2 - 0.02), CHAIR_SIZE.depth / 2 - 0.02],
    [CHAIR_SIZE.width / 2 - 0.02, -(CHAIR_SIZE.depth / 2 - 0.02)],
    [-(CHAIR_SIZE.width / 2 - 0.02), -(CHAIR_SIZE.depth / 2 - 0.02)],
  ];
  for (const [ox, oz] of offsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(ox, 0.225, oz);
    group.add(leg);
  }
  return group;
}

/**
 * models/desk.glb, models/chair.glb 가 있으면 그 모델을 불러오고,
 * 없거나 로딩에 실패하면(404 등) 대체용 박스 모델을 사용합니다.
 * 블렌더 모델을 넣는 방법은 models/README.md 를 참고하세요.
 * @param {string} filename
 * @param {() => THREE.Object3D} fallback
 */
/**
 * 블렌더에서 내보낸 모델은 벽/천장 같은 얇은 면의 법선(normal)이 방 안쪽을 향하지 않는 경우가
 * 있어서, 안에서 보면 뒷면 컬링(backface culling) 때문에 그 면이 통째로 안 보이고 뻥 뚫린
 * 것처럼(예: 천장이 새까맣게) 보일 수 있습니다. 양면 렌더링으로 바꿔서 이 문제를 막습니다.
 * @param {THREE.Object3D} obj
 */
function forceDoubleSide(obj) {
  obj.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      mat.side = THREE.DoubleSide;
    }
  });
}

async function loadModelOrPlaceholder(filename, fallback) {
  try {
    const url = new URL(filename, MODELS_BASE).href;
    const gltf = await loader.loadAsync(url);
    const obj = gltf.scene;
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    forceDoubleSide(obj);
    return { template: obj, isCustom: true };
  } catch {
    return { template: fallback(), isCustom: false };
  }
}

export async function loadDeskTemplate() {
  return loadModelOrPlaceholder('desk.glb', placeholderDesk);
}

export async function loadChairTemplate() {
  return loadModelOrPlaceholder('chair.glb', placeholderChair);
}

/**
 * models/classroom.glb 가 있으면 그 모델을 교실 배경으로 사용합니다.
 * 없으면 null을 반환해서 호출한 쪽(scene3d.js)이 기존처럼 벽/칠판을
 * 코드로 직접 그리는 방식으로 대체하도록 합니다.
 */
export async function loadClassroomTemplate() {
  try {
    const url = new URL('classroom.glb', MODELS_BASE).href;
    const gltf = await loader.loadAsync(url);
    const obj = gltf.scene;
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    forceDoubleSide(obj);
    return obj;
  } catch {
    return null;
  }
}
