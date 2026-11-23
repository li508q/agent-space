# AgentSpace · macOS Apple Silicon

## English

1. Move `AgentSpace.app` to the local folder where you will keep it, then open it.
2. Create/open a space or try the separate example. Direct use needs no API key or separate Node installation.
3. To connect an agent, create scoped access in **Settings** and add the copied configuration to your agent application's MCP settings. If you move the app later, update the executable path in those settings and reconnect.

Spaces and preferences live outside the application bundle. Back up spaces separately through the app.

The build uses ad-hoc signing, without Developer ID or notarization. macOS may block downloaded copies. Check the build's source and checksum.

## 简体中文

1. 将 `AgentSpace.app` 放到准备长期使用的本地文件夹，再打开应用。
2. 创建或打开空间，也可试用独立示例。直接使用无需 API key 或另装 Node。
3. 在**设置**中创建限定范围的接入授权，将复制的配置添加到所用 Agent 工具的 MCP 设置。之后移动应用时，请更新该设置中的可执行文件路径并重新连接。

空间与偏好设置保存在应用包之外。请通过应用单独备份空间。

构建采用 ad-hoc 签名，没有 Developer ID 或公证。macOS 可能阻止下载的副本。请核对构建来源与校验值。

## 日本語

1. `AgentSpace.app` を今後使うローカルフォルダーに置き、そこから開きます。
2. スペースを作成・開くか、独立したサンプルを試します。直接利用に API キーや Node の追加インストールは不要です。
3. **設定**でアクセス範囲を指定して接続権限を作成します。コピーした接続設定を、エージェントを使うアプリの MCP 設定に追加してください。後でアプリを移動した場合は、その設定で実行ファイルのパスを更新し、接続し直してください。

スペースと環境設定はアプリのバンドル外に保存されます。スペースはアプリから別途バックアップしてください。

このビルドは ad-hoc 署名のみで、Developer ID による署名や公証は行っていません。macOS がダウンロードしたコピーをブロックする場合があります。配布元とチェックサムを確認してください。

## 한국어

1. `AgentSpace.app`을 계속 사용할 로컬 폴더에 둔 뒤 그곳에서 엽니다.
2. 공간을 만들거나 열고, 별도의 예제를 사용해 볼 수 있습니다. 직접 사용에는 API 키나 별도 Node 설치가 필요하지 않습니다.
3. **설정**에서 접근 범위를 지정해 권한을 만들고, 복사한 구성을 에이전트를 사용하는 앱의 MCP 설정에 추가하세요. 나중에 앱을 옮기면 해당 설정에서 실행 파일 경로를 수정하고 다시 연결하세요.

스페이스와 환경설정은 앱 번들 밖에 저장됩니다. 앱에서 스페이스를 별도로 백업하세요.

빌드는 ad-hoc 서명이며 Developer ID와 공증이 없습니다. macOS가 다운로드한 복사본을 차단할 수 있습니다. 소스와 체크섬을 확인하세요.

## Español

1. Coloca `AgentSpace.app` en la carpeta local donde vayas a conservarla y ábrela desde allí.
2. Crea o abre un espacio, o prueba el ejemplo independiente. El uso directo no requiere una clave de API ni instalar Node.
3. Crea un acceso con un ámbito explícito en **Ajustes** y añade la configuración copiada a los ajustes MCP de la aplicación anfitriona del agente. Si mueves AgentSpace después, actualiza la ruta del ejecutable en esos ajustes y vuelve a conectar.

Los espacios y las preferencias se guardan fuera del paquete de la aplicación. Haz copias de seguridad de los espacios por separado desde la aplicación.

La compilación tiene firma ad-hoc, sin Developer ID ni notarización. macOS puede bloquear las copias descargadas. Comprueba el código fuente y la suma de verificación.

## Bundled CLI

From the folder containing the app:

```sh
"./AgentSpace.app/Contents/MacOS/AgentSpace" --agent-cli --help
```
