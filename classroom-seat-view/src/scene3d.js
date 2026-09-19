import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { store } from './state.js';
import { BOARD_BOTTOM, BOARD_HEIGHT, CHAIR_SIZE, DESK_SIZE, EYE_HEIGHT } from './types.js';
import { loadChairTemplate, loadClassroomTemplate, loadDeskTemplate } from './models.js';

// 블렌더에서 만든 교실(classroom.glb)의 원래 치수(m).
// 사용자가 UI에서 교실 가로/세로를 바꾸면 이 기준 치수 대비 비율로 늘리거나 줄여서 맞춥니다.
const CLASSROOM_MODEL_SIZE = { width: 7.2, depth: 7.6 };

function studentFigure() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8892b0 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.55, 12), mat);
  body.position.y = 0.95 + 0.275;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), mat);
  head.position.y = 0.95 + 0.55 + 0.11;
  group.add(head);
  return group;
}

function seatLocalOffset() {
  // 책상 기준 의자 중심 위치 (책상 로컬 좌표계, +z = 칠판 반대 방향)
  return DESK_SIZE.depth / 2 + CHAIR_SIZE.depth / 2;
}

/**
 * @param {import('./types.js').Desk} desk
 * @returns {THREE.Vector3}
 */
export function seatWorldPosition(desk) {
  const offset = seatLocalOffset();
  const lx = 0;
  const lz = offset;
  const cos = Math.cos(desk.rotation);
  const sin = Math.sin(desk.rotation);
  const wx = desk.x + (lx * cos - lz * sin);
  const wz = desk.z + (lx * sin + lz * cos);
  return new THREE.Vector3(wx, 0, wz);
}

export class Scene3D {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 실제 블렌더 모델(PBR 재질)이 밋밋하게 안 보이도록 색공간/톤매핑/환경광을 보정합니다.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0b10);
    this.scene.fog = new THREE.Fog(0x0a0b10, 8, 22);

    // 은은한 실내 환경광(PMREM) - 반사/금속 재질이 완전히 납작하게 보이는 것을 막아줍니다.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);

    this.roomGroup = new THREE.Group();
    this.desksGroup = new THREE.Group();
    this.scene.add(this.roomGroup);
    this.scene.add(this.desksGroup);

    this.obstacleMeshes = [];

    this.deskTemplate = null;
    this.chairTemplate = null;
    this.usingCustomDesk = false;
    this.usingCustomChair = false;
    this.classroomTemplate = null; // models/classroom.glb (없으면 null, 코드로 벽을 그림)

    this.active = false;
    this.raf = 0;

    this.yaw = 0;
    this.pitch = 0;
    this.dragging = false;
    this.lastPointer = { x: 0, y: 0 };

    this.selectedDeskId = null;
    /** @type {((result: {percent:number,label:string}|null) => void)|null} */
    this.onScore = null;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2c38, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff4e0, 1.6);
    dir.position.set(4, 8, 4);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    dir.shadow.camera.left = -6;
    dir.shadow.camera.right = 6;
    dir.shadow.camera.top = 6;
    dir.shadow.camera.bottom = -6;
    dir.shadow.bias = -0.0015;
    this.scene.add(dir);
    // 반대쪽에서 은은하게 채워주는 보조광 (그림자 쪽이 완전히 까맣게 되는 것 방지)
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
    fill.position.set(-4, 5, -3);
    this.scene.add(fill);

    // 후처리(포스트 프로세싱): SSAO로 물체가 맞닿는 부분에 자연스러운 접촉 그림자를 더해서
    // 납작한 3D 그래픽 느낌을 줄이고 좀 더 사실적으로 보이게 합니다.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ssaoPass = new SSAOPass(this.scene, this.camera, 1, 1);
    this.ssaoPass.kernelRadius = 0.35;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.15;
    this.composer.addPass(this.ssaoPass);
    this.composer.addPass(new OutputPass());

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.005;
      this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch - dy * 0.005));
    });

    window.addEventListener('resize', () => this.resize());

    store.subscribe(() => this.rebuild());

    this.loop = this.loop.bind(this);
  }

  async init() {
    const [desk, chair, classroom] = await Promise.all([
      loadDeskTemplate(),
      loadChairTemplate(),
      loadClassroomTemplate(),
    ]);
    this.deskTemplate = desk.template;
    this.usingCustomDesk = desk.isCustom;
    this.chairTemplate = chair.template;
    this.usingCustomChair = chair.isCustom;
    this.classroomTemplate = classroom;
    this.rebuild();
  }

  /** @param {boolean} active */
  setActive(active) {
    this.active = active;
    if (active) {
      this.resize();
      if (!this.raf) this.loop();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setSize(w, h);
      this.ssaoPass.setSize(w, h);
    }
  }

  rebuildRoom() {
    this.roomGroup.clear();
    const { room } = store.getState();

    if (this.classroomTemplate) {
      // 블렌더로 만든 실제 교실 모델(models/classroom.glb) 사용.
      // 모델은 가로 7.6m x 세로 7.2m 기준으로 만들어져 있어서, 사용자가 UI에서
      // 교실 크기를 바꾸면 그 비율만큼 가로/세로 방향으로 늘리거나 줄여서 맞춥니다.
      const model = this.classroomTemplate.clone(true);
      model.scale.set(room.width / CLASSROOM_MODEL_SIZE.width, 1, room.depth / CLASSROOM_MODEL_SIZE.depth);
      this.roomGroup.add(model);
      return;
    }

    this.buildProceduralRoom(room);
  }

  /**
   * models/classroom.glb 가 없을 때 쓰는 대체용 교실(단순한 박스 벽 + 칠판).
   * @param {import('./types.js').RoomConfig} room
   */
  buildProceduralRoom(room) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(room.width, room.depth),
      new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(room.width / 2, 0, room.depth / 2);
    floor.receiveShadow = true;
    this.roomGroup.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1c1e2b,
      roughness: 1,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
    });
    const wallHeight = 2.6;

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(room.width, wallHeight), wallMat);
    backWall.position.set(room.width / 2, wallHeight / 2, room.depth);
    backWall.rotation.y = Math.PI;
    this.roomGroup.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(room.depth, wallHeight), wallMat);
    leftWall.position.set(0, wallHeight / 2, room.depth / 2);
    leftWall.rotation.y = Math.PI / 2;
    this.roomGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(room.depth, wallHeight), wallMat);
    rightWall.position.set(room.width, wallHeight / 2, room.depth / 2);
    rightWall.rotation.y = -Math.PI / 2;
    this.roomGroup.add(rightWall);

    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(room.width, wallHeight), wallMat);
    frontWall.position.set(room.width / 2, wallHeight / 2, 0);
    this.roomGroup.add(frontWall);

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(room.boardWidth, BOARD_HEIGHT),
      new THREE.MeshStandardMaterial({ color: 0xe8c37a, roughness: 0.35, metalness: 0.15 }),
    );
    board.position.set(room.width / 2, BOARD_BOTTOM + BOARD_HEIGHT / 2, 0.02);
    this.boardMesh = board;
    this.roomGroup.add(board);

    this.addFurnishings(room);
  }

  /**
   * 사용자가 보내준 실제 교실 사진(창문+신발장, 뒷문+책장, 칠판 위 태극기/베트남 국기+시계,
   * 나무 교탁, 파란 의자 등)을 참고해서 대략적인 분위기만 재현하는 장식 요소들.
   * 정확한 복제가 아니라 "우리반 느낌"을 주는 단순화된 표현입니다.
   * @param {import('./types.js').RoomConfig} room
   */
  addFurnishings(room) {
    // --- 왼쪽 벽: 창문 2개 + 그 아래 신발장/사물함 ---
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2f6b4f });
    const paneMat = new THREE.MeshStandardMaterial({
      color: 0xbfe3f0,
      transparent: true,
      opacity: 0.45,
      roughness: 0.2,
    });
    const winW = Math.min(1.3, room.depth / 3.2);
    const winH = 1.0;
    const winY0 = 1.3;
    const winCenters = [room.depth * 0.32, room.depth * 0.68];
    for (const cz of winCenters) {
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(winW + 0.15, winH + 0.15), frameMat);
      frame.rotation.y = Math.PI / 2;
      frame.position.set(0.015, winY0 + winH / 2, cz);
      this.roomGroup.add(frame);

      const pane = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), paneMat);
      pane.rotation.y = Math.PI / 2;
      pane.position.set(0.03, winY0 + winH / 2, cz);
      this.roomGroup.add(pane);
    }

    const cubbyMat = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.85 });
    const cubbyDepth = Math.max(0.5, room.depth - 0.8);
    const cubby = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.0, cubbyDepth), cubbyMat);
    cubby.position.set(0.175, 0.5, room.depth / 2);
    this.roomGroup.add(cubby);
    const shelfLineMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45 });
    for (const y of [0.34, 0.67]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, cubbyDepth), shelfLineMat);
      line.position.set(0.175, y, room.depth / 2);
      this.roomGroup.add(line);
    }

    // --- 뒷벽: 문 + 작은 책장 ---
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xcbbfa5, roughness: 0.7 });
    const doorX = Math.max(1.0, room.width - 1.3);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.06), doorMat);
    door.position.set(doorX, 1.0, room.depth - 0.03);
    this.roomGroup.add(door);
    const doorWindow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x14161f }),
    );
    doorWindow.position.set(doorX, 1.55, room.depth - 0.07);
    this.roomGroup.add(doorWindow);

    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xa9784a, roughness: 0.85 });
    const shelfX = Math.max(0.6, doorX - 1.6);
    const bookshelf = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.3), shelfMat);
    bookshelf.position.set(shelfX, 0.5, room.depth - 0.16);
    this.roomGroup.add(bookshelf);

    // --- 앞벽: 칠판 위 태극기 + 베트남 국기 + 시계, 옆에 나무 교탁 ---
    const flagY = BOARD_BOTTOM + BOARD_HEIGHT + 0.28;
    const flagKr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xf4f4f4 }),
    );
    flagKr.position.set(room.width / 2 - 0.22, flagY, 0.02);
    this.roomGroup.add(flagKr);
    const flagVn = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xda251d }),
    );
    flagVn.position.set(room.width / 2 + 0.22, flagY, 0.02);
    this.roomGroup.add(flagVn);

    const clock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.02, 24),
      new THREE.MeshStandardMaterial({ color: 0xf5f0e6 }),
    );
    clock.rotation.x = Math.PI / 2;
    clock.position.set(room.width / 2 + room.boardWidth / 2 + 0.55, 2.15, 0.02);
    this.roomGroup.add(clock);

    const podiumMat = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.8 });
    const podiumX = Math.min(room.width - 0.3, room.width / 2 + room.boardWidth / 2 + 0.45);
    const podium = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.4), podiumMat);
    podium.position.set(podiumX, 0.5, 0.35);
    this.roomGroup.add(podium);

    // --- 오른쪽 벽: 학급 게시판/시간표 느낌의 코르크보드 ---
    const board2 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xede6d6 }),
    );
    board2.rotation.y = -Math.PI / 2;
    board2.position.set(room.width - 0.015, 1.6, room.depth * 0.38);
    this.roomGroup.add(board2);
  }

  rebuildDesks() {
    this.desksGroup.clear();
    this.obstacleMeshes = [];
    const { desks, selectedDeskId } = store.getState();

    for (const d of desks) {
      const deskObj = this.deskTemplate ? this.deskTemplate.clone(true) : new THREE.Group();
      deskObj.position.set(d.x, 0, d.z);
      deskObj.rotation.y = d.rotation;
      this.desksGroup.add(deskObj);

      const seatPos = seatWorldPosition(d);
      const chairObj = this.chairTemplate ? this.chairTemplate.clone(true) : new THREE.Group();
      chairObj.position.set(seatPos.x, 0, seatPos.z);
      chairObj.rotation.y = d.rotation;
      this.desksGroup.add(chairObj);

      this.obstacleMeshes.push(deskObj, chairObj);

      if (d.id !== selectedDeskId) {
        const figure = studentFigure();
        figure.position.set(seatPos.x, 0, seatPos.z);
        figure.rotation.y = d.rotation;
        this.desksGroup.add(figure);
        this.obstacleMeshes.push(figure);
      }
    }
  }

  rebuild() {
    this.rebuildRoom();
    this.rebuildDesks();
    if (this.selectedDeskId) this.focusSeat(this.selectedDeskId);
  }

  /** @param {string} deskId */
  focusSeat(deskId) {
    this.selectedDeskId = deskId;
    const { desks, room } = store.getState();
    const desk = desks.find((d) => d.id === deskId);
    if (!desk) {
      this.onScore?.(null);
      return;
    }
    this.rebuildDesks(); // 선택된 학생 자신의 몸은 표시하지 않도록 다시 빌드

    const seatPos = seatWorldPosition(desk);
    const eye = new THREE.Vector3(seatPos.x, EYE_HEIGHT, seatPos.z);
    this.camera.position.copy(eye);

    const boardCenter = new THREE.Vector3(room.width / 2, BOARD_BOTTOM + BOARD_HEIGHT / 2, 0);
    const dir = boardCenter.clone().sub(eye);
    this.yaw = Math.atan2(dir.x, dir.z) + Math.PI;
    this.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));

    this.onScore?.(this.computeVisibility(eye));
  }

  /** @param {THREE.Vector3} eye */
  computeVisibility(eye) {
    const { room } = store.getState();

    const bx0 = room.width / 2 - room.boardWidth / 2 + room.boardWidth * 0.08;
    const bx1 = room.width / 2 + room.boardWidth / 2 - room.boardWidth * 0.08;
    const by0 = BOARD_BOTTOM + BOARD_HEIGHT * 0.12;
    const by1 = BOARD_BOTTOM + BOARD_HEIGHT * 0.88;
    const samples = [
      new THREE.Vector3((bx0 + bx1) / 2, (by0 + by1) / 2, 0.02),
      new THREE.Vector3(bx0, by0, 0.02),
      new THREE.Vector3(bx1, by0, 0.02),
      new THREE.Vector3(bx0, by1, 0.02),
      new THREE.Vector3(bx1, by1, 0.02),
    ];

    const raycaster = new THREE.Raycaster();
    let visible = 0;
    for (const p of samples) {
      const dir = p.clone().sub(eye);
      const dist = dir.length();
      dir.normalize();
      raycaster.set(eye, dir);
      raycaster.far = dist - 0.05;
      const hits = raycaster.intersectObjects(this.obstacleMeshes, true);
      if (hits.length === 0) visible++;
    }

    const percent = Math.round((visible / samples.length) * 100);
    let label = '많이 가려져요';
    if (percent >= 90) label = '칠판이 아주 잘 보여요';
    else if (percent >= 70) label = '대체로 잘 보이는 편이에요';
    else if (percent >= 40) label = '일부 가려질 수 있어요';
    return { percent, label };
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.active) return;

    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    this.camera.quaternion.copy(qYaw).multiply(qPitch);

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  get isUsingCustomModels() {
    return { desk: this.usingCustomDesk, chair: this.usingCustomChair };
  }
}
