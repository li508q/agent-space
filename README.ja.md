<img src="docs/assets/banner.svg" alt="AgentSpace" width="480">

[English](README.md) · [简体中文](README.zh-CN.md) · 日本語 · [한국어](README.ko.md) · [Español](README.es.md)

# 仕事は、会話の先へ。

エージェントを変えるたび、プロジェクトの説明を繰り返す。ノートはフォルダに、判断はチャットに散らばる。AI が作業を進めても、何が変わったのかを追う手間が増えていく。

**AgentSpace は、自分で所有するローカルワークスペースです。** 自分で書き、資料を整理し、異なるエージェントと文脈を共有できます。提案と根拠を読み、どの変更を反映するかを自分で決められます。

[使い始める](#使い始める) · [使い方](docs/guides/ja.md) · [アーキテクチャ](docs/ARCHITECTURE.md)

## エージェントを変えても、文脈を引き継ぐ

ノート、文書、型付きレコード、再利用するアセットへの参照をプロジェクトに関連づけます。蓄積した資料を読み、直接編集し、保存済みの版を明示した説明をエージェントに渡せます。

モデルのアカウントや API キーなしで使えます。手伝ってほしいときに、MCP や CLI で外部エージェントを接続してください。

<img src="docs/assets/workbench.ja.png" alt="プロジェクト、関連資料、直接編集を備えた AgentSpace ワークスペース。サンプル資料を表示" width="1200">

## 変更を確かめ、自分で決める

提案の理由、差分全体、引用元の版を読んでから、適用するか却下するかを選びます。自分の編集は直接保存されます。バージョンチェック、復旧用の下書き、条件付きの取り消しで、その後の作業を保護します。

適用時の版と出典を後から確認できます。会話が終わっても、仕事の経緯は残ります。

<img src="docs/assets/review.ja.png" alt="差分、理由、引用元の版を表示する提案と、適用・却下の操作" width="1200">

## 使い始める

デスクトップ版は **Apple Silicon 搭載の Mac、macOS 13 以降**に対応しています。

[Mac アプリ](https://github.com/li508q/agent-space/releases/latest)と `SHA256SUMS` をダウンロードします。ダウンロード先で ZIP を検証してから展開してください。

```sh
shasum -a 256 -c SHA256SUMS
```

`AgentSpace.app` を今後使うローカルフォルダーに置き、開きます。ランタイムを内蔵しているため、Node の追加インストールやモデルのアカウントは不要です。配布版は ad-hoc 署名のみで、Apple の公証は受けていません。[インストールと macOS のセキュリティ](docs/DESKTOP.md#install-the-desktop)をご覧ください。

### ソースから実行する

[`.nvmrc`](.nvmrc) で指定した Node を使い、次を実行してください。

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

自分のスペースを作るか、別に保存されるサンプルスペースを試せます。`npm run package:mac` でランタイム内蔵の単体アプリを作成できます。[ビルドと対応環境](docs/DESKTOP.md)。

**設定 → エージェント接続を設定**で資料と権限を選び、生成された設定をエージェントを使うアプリの MCP 設定に追加します。ノートやレコードの新規作成には、別途許可が必要です。[MCP・CLI](docs/AGENT_PROTOCOL.md)。

## 人とエージェントに共通のコア

Electron／React のデスクトップ、MCP サーバー、CLI は、同じ TypeScript Core と SQLite のデータ基盤を使います。オブジェクトの識別、出典の版、アクセス権、提案の判断に共通のルールを適用します。Markdown の編集には CodeMirror を使います。

[アーキテクチャ](docs/ARCHITECTURE.md) · [Core API](docs/CORE_API.md) · [検証と制限](docs/TESTING.md) · [CI](https://github.com/li508q/agent-space/actions)

## データは自分の手元に

元ファイルを残したまま、編集可能なコピーを取り込めます。全体バックアップで履歴を保管し、現行内容を読み取り用の形式で書き出せます。外部参照の指すファイルは、別に管理します。

スペースはローカルファイルで、AgentSpace 自体は暗号化しません。接続先エージェントを使うアプリが、許可された資料をモデル提供元へ送る場合があります。権限を取り消すと以後の要求を止められますが、渡した内容は回収できません。

[データと信頼の境界](docs/SECURITY.md) · [バックアップと復元](docs/LOCAL_DATA.md)

## 一緒に育てる

文脈を見つけ、変更を理解し、作業を復旧しやすくするための貢献を歓迎します。開発手順とチェックは[貢献ガイド](CONTRIBUTING.md)、製品と実装の仕様は[文書一覧](docs/README.md)をご覧ください。

UI と使い方のガイドは、**英語、簡体字中国語、日本語、韓国語、スペイン語**に対応しています。自分で書いた内容は元の言語を保ちます。

[製品の範囲](docs/PRD.md) · [MIT ライセンス](LICENSE)
