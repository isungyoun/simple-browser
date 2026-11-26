# simple-browser 작업 규칙

## 수정과 빌드

- 기본적으로 소스 수정과 필요한 테스트만 진행한다.
- 사용자가 빌드를 명시적으로 요청하면 모아둔 수정 사항을 한꺼번에 빌드한다. 수정할 때마다 설치 파일을 다시 만들지 않는다.
- 빌드 요청에 추가 수정이 들어오면 해당 수정과 검증을 마친 최종 상태로 설치 파일을 만든다.

## 배포 파일

- 최종 배포 파일은 macOS `.pkg`와 Windows 설치 `.exe`만 제공한다. DMG는 만들지 않는다. `.pkg`는 기존 앱을 대치 확인 없이 `/Applications`에 업그레이드 설치한다.
- ZIP은 만들지 않는다. 앱 ZIP, 소스 ZIP, 빌드 중간 ZIP 모두 생성하지 않는다.
- `.blockmap`은 생성하지 않는다. `build.nsis.differentialPackage`는 `false`로 유지한다.
- Windows NSIS 설치 EXE에 앱을 포함하기 위한 임시 `.nsis.7z`는 허용한다. 빌드 도구가 EXE에 포함한 뒤 자동 삭제하는 정상 중간 파일이다.
- 실행 중인 빌드의 임시 7z를 삭제하지 않는다. 빌드 성공 후 임시 7z가 남지 않았는지 확인하고, 별도 배포하지 않는다.
- 기존 사용자 파일이나 이전 배포 파일을 요청 없이 일괄 삭제하지 않는다. 단, `npm run release`는 사용자 요청에 따라 최신 버전 외의 로컬 설치 파일과 이전 GitHub 릴리스를 삭제한다.
- 설치 파일은 100MB를 넘어 git에 커밋하지 않는다. 커밋·푸시 요청 시 커밋과 푸시 후 `npm run release`로 최신 PKG·EXE를 GitHub Releases(`v<버전>`)에 올린다. `gh` 로그인이 필요하다.

## 빌드 및 검증

- 빌드 요청 시 기본으로 Mac과 Windows 설치 파일을 함께 만든다: `npm run dist` (= `dist:mac` + `dist:win`).
- macOS만: `npm run dist:mac` (기본 Apple Silicon), Intel은 요청 시 `npm run dist:mac:intel`.
- Windows만: `npm run dist:win`.
- Mac PKG는 `scripts/make-mac-pkg.js`가 빌드 앱을 직접 복사·서명 검증한 뒤 만들고, 끝나면 빌드 앱을 `dist/mac-arm64.noindex`로 옮긴다. ZIP 왕복 방식을 넣지 않는다. `BundleIsRelocatable`은 `false`로 유지해 항상 `/Applications`에 설치되게 한다.
- 변경에 맞는 테스트와 패키지 검증을 수행한다. 소스 테스트만으로 실제 계정 로그인이나 Windows 실행까지 확인했다고 말하지 않는다.
- 완료 시 버전, 설치 파일 링크, 주요 검증 결과를 짧게 알린다.
