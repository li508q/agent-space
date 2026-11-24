# AgentSpace · macOS Apple Silicon

## English

Requires **Apple Silicon and macOS 13 or later**. Download the macOS arm64 ZIP and `SHA256SUMS` from [GitHub Releases](https://github.com/li508q/agent-space/releases/latest). Keep both files together and verify before extracting:

```sh
shasum -a 256 -c SHA256SUMS
```

1. Move `AgentSpace.app` to the local folder where you will keep it, then open it.
2. Create/open a space or try the separate example. The app includes its runtime; direct use needs neither a Node installation nor a model account or API key.
3. To connect an agent, create scoped access in **Settings** and add the copied configuration to your agent application's MCP settings. If you move the app later, update the executable path in those settings and reconnect.

Spaces and preferences live outside the application bundle. Back up spaces separately through the app.

The download uses ad-hoc signing, without a Developer ID signature or Apple notarization. If macOS blocks it, check the source and checksum, then follow [Apple's Open Anyway instructions](https://support.apple.com/en-us/102445). AgentSpace does not change macOS security settings.

## 简体中文

需要 **Apple Silicon 芯片及 macOS 13 或更新版本**。从 [GitHub Releases](https://github.com/li508q/agent-space/releases/latest) 下载 macOS arm64 ZIP 和 `SHA256SUMS`，放在同一文件夹，解压前核验：

```sh
shasum -a 256 -c SHA256SUMS
```

1. 将 `AgentSpace.app` 放到准备长期使用的本地文件夹，再打开应用。
2. 创建或打开空间，也可试用独立示例。应用自带运行环境，直接使用无需安装 Node，也无需模型账号或 API key。
3. 在**设置**中创建限定范围的接入授权，将复制的配置添加到所用 Agent 工具的 MCP 设置。之后移动应用时，请更新该设置中的可执行文件路径并重新连接。

空间与偏好设置保存在应用包之外。请通过应用单独备份空间。

下载包采用 ad-hoc 签名，没有 Developer ID 签名或 Apple 公证。若 macOS 阻止打开，请先核对来源与校验值，再按 [Apple 的“仍要打开”说明](https://support.apple.com/en-us/102445)操作。AgentSpace 不会修改 macOS 安全设置。

## 日本語

**Apple Silicon と macOS 13 以降**が必要です。[GitHub Releases](https://github.com/li508q/agent-space/releases/latest) から macOS arm64 の ZIP と `SHA256SUMS` をダウンロードし、同じフォルダーに置いて、展開前に確認してください。

```sh
shasum -a 256 -c SHA256SUMS
```

1. `AgentSpace.app` を今後使うローカルフォルダーに置き、そこから開きます。
2. スペースを作成・開くか、独立したサンプルを試します。アプリには実行環境が含まれています。直接利用に Node のインストール、モデルのアカウント、API キーは不要です。
3. **設定**でアクセス範囲を指定して接続権限を作成します。コピーした接続設定を、エージェントを使うアプリの MCP 設定に追加してください。後でアプリを移動した場合は、その設定で実行ファイルのパスを更新し、接続し直してください。

スペースと環境設定はアプリのバンドル外に保存されます。スペースはアプリから別途バックアップしてください。

配布物は ad-hoc 署名のみで、Developer ID による署名や Apple の公証はありません。macOS にブロックされた場合は配布元とチェックサムを確認し、[Apple の「このまま開く」の説明](https://support.apple.com/en-us/102445)に従ってください。AgentSpace が macOS のセキュリティ設定を変更することはありません。

## 한국어

**Apple Silicon과 macOS 13 이상**이 필요합니다. [GitHub Releases](https://github.com/li508q/agent-space/releases/latest)에서 macOS arm64 ZIP과 `SHA256SUMS`를 받아 같은 폴더에 두세요. 압축을 풀기 전에 확인합니다.

```sh
shasum -a 256 -c SHA256SUMS
```

1. `AgentSpace.app`을 계속 사용할 로컬 폴더에 둔 뒤 그곳에서 엽니다.
2. 스페이스를 만들거나 열고 별도의 예제를 사용해 볼 수 있습니다. 앱에 실행 환경이 포함되어 있어 직접 사용할 때는 Node 설치, 모델 계정이나 API 키가 필요하지 않습니다.
3. **설정**에서 접근 범위를 지정해 권한을 만들고, 복사한 구성을 에이전트를 사용하는 앱의 MCP 설정에 추가하세요. 나중에 앱을 옮기면 해당 설정에서 실행 파일 경로를 수정하고 다시 연결하세요.

스페이스와 환경설정은 앱 번들 밖에 저장됩니다. 앱에서 스페이스를 별도로 백업하세요.

배포 파일은 ad-hoc 서명만 사용하며 Developer ID 서명이나 Apple 공증은 없습니다. macOS가 앱을 차단하면 출처와 체크섬을 확인한 뒤 [Apple의 ‘확인 없이 열기’ 안내](https://support.apple.com/en-us/102445)를 따르세요. AgentSpace는 macOS 보안 설정을 변경하지 않습니다.

## Español

Necesitas **Apple Silicon y macOS 13 o posterior**. Descarga el ZIP para macOS arm64 y `SHA256SUMS` desde [GitHub Releases](https://github.com/li508q/agent-space/releases/latest). Guarda ambos en la misma carpeta y verifica antes de extraer:

```sh
shasum -a 256 -c SHA256SUMS
```

1. Coloca `AgentSpace.app` en la carpeta local donde vayas a conservarla y ábrela desde allí.
2. Crea o abre un espacio, o prueba el ejemplo independiente. La aplicación incluye su entorno de ejecución; el uso directo no requiere instalar Node, una cuenta de un proveedor de modelos ni una clave de API.
3. Crea un acceso con un ámbito explícito en **Ajustes** y añade la configuración copiada a los ajustes MCP de la aplicación anfitriona del agente. Si mueves AgentSpace después, actualiza la ruta del ejecutable en esos ajustes y vuelve a conectar.

Los espacios y las preferencias se guardan fuera del paquete de la aplicación. Haz copias de seguridad de los espacios por separado desde la aplicación.

La descarga tiene firma ad-hoc, sin firma Developer ID ni notarización de Apple. Si macOS la bloquea, comprueba su origen y suma de verificación y sigue las [instrucciones de Apple para Abrir igualmente](https://support.apple.com/en-us/102445). AgentSpace no cambia los ajustes de seguridad de macOS.

## Bundled CLI

From the folder containing the app:

```sh
"./AgentSpace.app/Contents/MacOS/AgentSpace" --agent-cli --help
```
