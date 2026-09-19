# 🪑 우리반 자리배치 시뮬레이터

교실 자리를 마우스로 배치하고, 각 자리에 앉았을 때 칠판이 어떻게 보이는지 3D로 미리 확인할 수 있는 웹앱입니다. **빌드 도구나 서버가 전혀 필요 없는 순수 정적 사이트**라서, GitHub Pages에 파일만 올리면 바로 동작합니다.

- **배치 편집** 탭: 교실 크기와 칠판 폭을 정하고, 책상을 추가해서 자유롭게 드래그로 배치
- **좌석 미리보기** 탭: 좌석을 선택하면 그 자리 눈높이에서 칠판을 보는 1인칭 3D 화면과, 앞사람에게 시야가 얼마나 가려지는지 퍼센트 점수를 보여줌

3D 렌더링에는 [three.js](https://threejs.org/)를 쓰는데, `npm install` 없이 브라우저에서 CDN으로 바로 불러오도록 되어 있습니다(`index.html`의 `importmap` 참고). 그래서 설치 과정 없이 파일만 열어도 동작합니다.

## 1. 로컬에서 미리보기

아래 둘 중 편한 방법으로 확인하세요.

**방법 A — 그냥 index.html 더블클릭**
대부분의 브라우저에서 바로 열립니다. 다만 일부 브라우저는 보안 정책상 `file://` 로 열었을 때 모듈 불러오기가 막힐 수 있어요. 그럴 땐 방법 B를 쓰세요.

**방법 B — 아주 가벼운 로컬 서버 사용 (권장)**
파이썬이 설치되어 있다면 이 폴더에서:
```bash
python3 -m http.server 8080
```
그 다음 브라우저에서 `http://localhost:8080` 을 열면 됩니다. (Node.js가 있다면 `npx serve` 같은 명령도 됩니다.)

## 2. 책상/의자를 내 블렌더 모델로 바꾸기

기본값은 단순한 박스 모델입니다. `models/README.md` 안내를 따라 `desk.glb`, `chair.glb` 두 파일을 `models/` 폴더에 넣으면 자동으로 그 모델이 사용됩니다. (교실 자체 모델은 없어도 되고, 방/벽/칠판은 프로그램이 자동으로 그려줍니다.)

## 3. GitHub 저장소로 올리고 GitHub Pages로 배포하기

빌드 과정이 없기 때문에 파일을 그대로 올리기만 하면 됩니다.

1. GitHub에서 새 빈 저장소를 만듭니다 (예: `classroom-seat-view`). README, .gitignore 등은 만들지 말고 **완전히 빈 저장소**로 만드세요.
2. 이 프로젝트 폴더에서 아래 명령을 실행해 원격 저장소를 연결하고 올립니다.
   ```bash
   git remote add origin https://github.com/<내-깃허브아이디>/<저장소이름>.git
   git branch -M main
   git push -u origin main
   ```
3. GitHub 저장소 페이지에서 **Settings → Pages** 로 들어가서 **Build and deployment → Source** 를 **Deploy from a branch** 로 설정하고, Branch를 `main` / `/ (root)` 로 선택한 뒤 저장합니다.
4. 1~2분 정도 기다리면 Pages 설정 화면에 사이트 주소가 나타납니다. (`https://<내-깃허브아이디>.github.io/<저장소이름>/`)

이후에는 파일을 고치고 `git add`, `git commit`, `git push` 하면 자동으로 사이트에도 반영됩니다(보통 1분 이내).

## 4. 배치 저장/공유

- 자리 배치는 브라우저에 자동 저장됩니다 (localStorage).
- "배치 내보내기" 버튼으로 JSON 파일로 저장해서 다른 사람과 공유하거나 다른 브라우저에서 "배치 불러오기"로 열 수 있습니다.

## 폴더 구조

```
index.html          진입점 (importmap으로 three.js를 CDN에서 불러옴)
src/
  style.css          디자인
  main.js            화면 초기화 및 이벤트 연결
  state.js           자리배치 상태 관리 + localStorage 저장
  editor2d.js         2D 배치 편집기 (캔버스)
  scene3d.js          3D 좌석 미리보기 + 시야 계산 (three.js)
  models.js           블렌더 glb 모델 로딩 (없으면 기본 박스 모델)
  types.js            공용 상수/타입 주석
models/
  README.md          블렌더 모델(desk.glb, chair.glb) 넣는 방법
```

## 참고: 시야 점수는 어떻게 계산되나요?

선택한 좌석의 눈높이(약 1.15m)에서 칠판의 중앙과 네 모서리, 총 5개 지점으로 가상의 시선을 쏴서(raycasting) 그 사이에 다른 학생/책상이 가리는지 확인합니다. 5개 지점 중 가려지지 않고 보이는 비율이 퍼센트 점수입니다. 실제 교실과는 차이가 있을 수 있는 근사치예요.
