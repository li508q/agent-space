# AgentSpace · macOS Apple Silicon

**English** — Move `AgentSpace.app` to a local folder of your choice and open it. Create/open a space or try the separate example. The app includes Electron/Node; direct use needs no separate Node installation or API key. To connect an external agent, create a scoped grant in Settings and copy its configuration. Copy a fresh configuration after moving the app. This local build is ad-hoc signed, without Developer ID or notarization; macOS may block downloaded copies. Check the source and checksum before trusting a build.

**简体中文** — 将 `AgentSpace.app` 移到选定的本地文件夹后打开。创建或打开空间，也可试用独立示例。应用内置 Electron/Node；直接使用无需另装 Node 或填写 API key。外部 Agent 通过设置中明确授权的范围与复制出的配置接入。移动应用后，请重新复制配置。本地构建采用 ad-hoc 签名，没有 Developer ID 或公证；macOS 可能阻止下载的副本。信任构建前请核对源码与校验值。

**日本語** — `AgentSpace.app` を任意のローカルフォルダーに移して開きます。スペースを作成・開くか、独立したサンプルを試せます。Electron/Node を内蔵しており、直接利用する際に Node の追加インストールや API キーは不要です。外部エージェントは設定で範囲を許可し、構成をコピーして接続します。アプリを移動した後は構成をコピーし直してください。このローカルビルドは ad-hoc 署名で、Developer ID と公証はありません。macOS がダウンロードしたコピーをブロックする場合があります。信頼する前にソースとチェックサムを確認してください。

**한국어** — `AgentSpace.app`을 원하는 로컬 폴더로 옮긴 후 엽니다. 공간을 만들거나 열고, 별도의 예제를 사용해 볼 수 있습니다. Electron/Node가 포함되어 있으므로 직접 사용할 때 Node를 따로 설치하거나 API 키를 입력할 필요가 없습니다. 외부 에이전트는 설정에서 범위를 허용하고 구성을 복사하여 연결합니다. 앱을 옮긴 후에는 구성을 다시 복사하세요. 이 로컬 빌드는 ad-hoc 서명이며 Developer ID와 공증이 없습니다. macOS가 다운로드한 복사본을 차단할 수 있습니다. 신뢰하기 전에 소스와 체크섬을 확인하세요.

**Español** — Mueve `AgentSpace.app` a la carpeta local que prefieras y ábrela. Crea o abre un espacio, o prueba el ejemplo independiente. La app incluye Electron/Node; el uso directo no requiere instalar Node ni introducir una clave de API. Para conectar un agente externo, autoriza su alcance en Configuración y copia la configuración. Vuelve a copiarla si mueves la app. Esta compilación local tiene firma ad-hoc, sin Developer ID ni notarización; macOS puede bloquear las copias descargadas. Comprueba el código fuente y la suma de verificación antes de confiar en una compilación.

From the folder containing the app, the bundled command entry can show its usage:

```sh
"./AgentSpace.app/Contents/MacOS/AgentSpace" --agent-cli --help
```

Your selected space directories and private app preferences are outside the application bundle. Updating or moving the app does not include those spaces in the package. Back them up separately through the app's backup action.
