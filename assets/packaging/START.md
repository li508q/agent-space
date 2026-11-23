# AgentSpace · macOS Apple Silicon

## English

1. Move `AgentSpace.app` to a local folder and open it.
2. Create/open a space or try the separate example. Direct use needs no API key or separate Node installation.
3. To connect an agent, create scoped access in Settings and copy the configuration. Copy it again after moving the app.

The build uses ad-hoc signing, without Developer ID or notarization. macOS may block downloaded copies. Check the build's source and checksum.

## 简体中文

1. 将 `AgentSpace.app` 移到本地文件夹后打开。
2. 创建或打开空间，也可试用独立示例。直接使用无需 API key 或另装 Node。
3. 在设置中创建限定范围的访问权限并复制配置，以接入 Agent。移动应用后需重新复制配置。

构建采用 ad-hoc 签名，没有 Developer ID 或公证。macOS 可能阻止下载的副本。请核对构建来源与校验值。

## 日本語

1. `AgentSpace.app` をローカルフォルダーに移して開きます。
2. スペースを作成・開くか、独立したサンプルを試します。直接利用に API キーや Node の追加インストールは不要です。
3. 設定でアクセス範囲を指定し、構成をコピーしてエージェントを接続します。アプリを移動した後は構成をコピーし直します。

ビルドは ad-hoc 署名で、Developer ID と公証はありません。macOS がダウンロードしたコピーをブロックする場合があります。ソースとチェックサムを確認してください。

## 한국어

1. `AgentSpace.app`을 로컬 폴더로 옮긴 뒤 엽니다.
2. 공간을 만들거나 열고, 별도의 예제를 사용해 볼 수 있습니다. 직접 사용에는 API 키나 별도 Node 설치가 필요하지 않습니다.
3. 설정에서 접근 범위를 지정하고 구성을 복사해 에이전트를 연결합니다. 앱을 옮긴 뒤에는 구성을 다시 복사합니다.

빌드는 ad-hoc 서명이며 Developer ID와 공증이 없습니다. macOS가 다운로드한 복사본을 차단할 수 있습니다. 소스와 체크섬을 확인하세요.

## Español

1. Mueve `AgentSpace.app` a una carpeta local y ábrela.
2. Crea o abre un espacio, o prueba el ejemplo independiente. El uso directo no requiere una clave de API ni instalar Node.
3. Crea acceso con un alcance explícito en Configuración y copia la configuración para conectar un agente. Vuelve a copiarla si mueves la app.

La compilación tiene firma ad-hoc, sin Developer ID ni notarización. macOS puede bloquear las copias descargadas. Comprueba el código fuente y la suma de verificación.

## Bundled CLI

From the folder containing the app:

```sh
"./AgentSpace.app/Contents/MacOS/AgentSpace" --agent-cli --help
```

Spaces and preferences live outside the application bundle. Back up spaces separately through the app.
