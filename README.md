# Aria Workspace

현재 서비스는 저장소 최상위의 `index.html`에서 실행됩니다.

- 서비스 주소: https://affinity-neo.github.io/aria/
- `index.html`: Aria 디자인과 schedule2 업무·일정 기능을 통합한 메인 앱
- `gemini.js`: AI 비서 연결 스크립트
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: Aria 설치 및 알림 관련 파일
- `archive/aria-original/index.html`: 통합 전 기존 Aria 메인 화면 백업
- `aria/`: 기존 저장소 내 별도 보관본 (유지)

## 배포 및 복구

GitHub Pages는 main 브랜치의 최상위 폴더를 배포하도록 설정되어 있습니다.

기존 Aria 화면으로 되돌려야 할 경우 `archive/aria-original/index.html`의 내용을 최상위 `index.html`에 복사하면 됩니다. 기존 아이콘·매니페스트 파일은 최상위에 그대로 보존되어 있습니다.

## 알림 서버

기존 알림 워크플로와 서버 파일은 유지했습니다. GitHub Actions Secret 설정은 기존 배포 환경을 따릅니다.
