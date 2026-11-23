<img src="docs/assets/banner.svg" alt="AgentSpace" width="480">

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · 한국어 · [Español](README.es.md)

# 대화가 바뀌어도, 작업은 이어집니다.

에이전트를 바꾸면 프로젝트를 처음부터 다시 설명합니다. 노트는 폴더에, 판단은 대화에 흩어집니다. AI가 작업을 진행해도 무엇이 바뀌었는지 파악하는 일이 또 하나의 일이 됩니다.

**AgentSpace는 내가 소유하는 로컬 작업 공간입니다.** 직접 작성하고 자료를 정리하며 여러 에이전트와 맥락을 공유할 수 있습니다. 제안과 근거를 읽고 어떤 변경을 반영할지 직접 결정합니다.

[시작하기](#시작하기) · [사용 안내](docs/guides/ko.md) · [아키텍처](docs/ARCHITECTURE.md)

## 같은 맥락, 다른 에이전트

노트, 문서, 유형이 지정된 레코드, 재사용 자산 참조를 프로젝트에 연결합니다. 쌓인 자료를 살펴보고 직접 편집하며, 저장된 버전을 명시한 설명을 에이전트에 전달할 수 있습니다.

모델 계정이나 API 키 없이 사용할 수 있습니다. 도움이 필요할 때 MCP 또는 CLI로 외부 에이전트를 연결하세요.

<img src="docs/assets/workbench.ko.png" alt="프로젝트, 연결된 자료, 직접 작성 기능을 갖춘 AgentSpace 작업 공간. 예제 자료 표시" width="1200">

## 변경을 확인하고 직접 결정하세요

제안의 이유, 전체 차이와 인용한 출처 버전을 읽은 뒤 적용하거나 거절합니다. 직접 편집한 내용은 바로 저장됩니다. 버전 확인, 복구용 초안, 조건부 실행 취소로 이후 작업을 보호합니다.

적용 당시 버전과 출처를 다시 확인할 수 있습니다. 대화가 끝난 뒤에도 작업의 경위는 남습니다.

<img src="docs/assets/review.ko.png" alt="전체 차이, 이유, 출처 버전을 표시하는 제안과 적용·거절 기능" width="1200">

## 시작하기

데스크톱 앱은 **macOS Apple Silicon**에서 실행됩니다. [`.nvmrc`](.nvmrc)에 지정된 Node 버전으로 다음 명령을 실행하세요.

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

내 스페이스를 만들거나 별도로 저장되는 예제 스페이스를 둘러보세요. `npm run package:mac`으로 런타임이 포함된 독립 앱을 빌드할 수 있습니다. [빌드와 플랫폼 안내](docs/DESKTOP.md).

**설정 → 에이전트 접근 설정**에서 자료와 권한을 선택하고 에이전트를 사용하는 앱의 MCP 설정에 구성을 추가합니다. 새 노트나 레코드를 만들려면 별도 권한이 필요합니다. [MCP·CLI](docs/AGENT_PROTOCOL.md).

## 사람과 에이전트가 공유하는 코어

Electron/React 데스크톱, MCP 서버, CLI는 같은 TypeScript Core와 SQLite 데이터 기반을 사용합니다. 객체 식별, 출처 버전, 접근 권한과 제안 결정에 동일한 규칙을 적용합니다. Markdown 편집에는 CodeMirror를 사용합니다.

[아키텍처](docs/ARCHITECTURE.md) · [Core API](docs/CORE_API.md) · [검증과 제한](docs/TESTING.md) · [CI](https://github.com/li508q/agent-space/actions)

## 데이터는 내 손에

원본을 옮기지 않고 편집 가능한 사본을 가져옵니다. 전체 백업으로 이력을 보관하거나 현재 내용을 읽기 쉬운 형식으로 내보낼 수 있습니다. 외부 참조가 가리키는 파일은 별도로 관리합니다.

스페이스는 로컬 파일이며 AgentSpace 자체는 암호화하지 않습니다. 연결된 에이전트를 사용하는 앱이 허용된 자료를 모델 제공자에게 보낼 수 있습니다. 권한 취소는 이후 요청을 차단하지만 이미 전달한 자료를 회수하지는 못합니다.

[데이터와 신뢰 경계](docs/SECURITY.md) · [백업과 복구](docs/LOCAL_DATA.md)

## 함께 만들어 가기

맥락을 찾고, 변경을 이해하며, 작업을 복구하기 쉽게 만드는 기여를 환영합니다. 개발 준비와 확인 방법은 [기여 안내](CONTRIBUTING.md), 제품과 구현 명세는 [문서 목록](docs/README.md)을 참고하세요.

UI와 사용 안내는 **영어, 중국어 간체, 일본어, 한국어, 스페인어**를 지원합니다. 직접 작성한 내용은 원래 언어를 유지합니다.

[제품 범위](docs/PRD.md) · [MIT 라이선스](LICENSE)
