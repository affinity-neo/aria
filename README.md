# Aria 설치 순서

1. 이 폴더의 파일을 전부 GitHub 저장소(공개)에 올리세요. `.github/workflows/notify.yml` 은 경로 그대로여야 해요.
   (웹에서는 Add file > Create new file 에서 이름 칸에 `.github/workflows/notify.yml` 이라고 입력하고 내용을 붙여넣으면 폴더가 만들어져요.)
2. Settings > Pages 에서 main 브랜치를 켜세요. 주소는 https://아이디.github.io/저장소이름/ 이에요.
3. Settings > Secrets and variables > Actions > New repository secret
   - 이름 `VAPID_PRIVATE_KEY`, 값 `QSHAQ_jMEA76YUc1Rc42NemwJG4JxcOh5qkjfT3x4Yc`  (남에게 알려 주지 마세요)
4. 앱 설정에서 구글 캘린더 연결 > 알림 켜기 > 서버 설정값 복사 > 시크릿 `PUSH_1` 로 저장.
5. Actions 탭 > Aria 알림 > Run workflow 로 테스트.

아이폰: iOS 16.4 이상, Safari에서 홈 화면에 추가한 뒤 그 아이콘으로 열어서 알림을 켜세요.
