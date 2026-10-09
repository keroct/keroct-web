# KEROCT造船所 Webサイト

作品と作り手を見て、制作について相談できるショールームの初版です。

## ページ

- `index.html`: 制作例、クリエイター紹介、制作メニュー、依頼の流れ
- `pricing/index.html`: デザイン・イラスト・セット・オプションと制作条件
- `creators/kaerunoankake/index.html`: かえるのあんかけの制作例とXへのリンク
- `docs/keroct-web-concept-revised-2026-10-06.md`: 提供された構想書の原文

HTML、CSS、JavaScriptだけで動作します。ビルドや外部パッケージのインストールは不要です。ページ・画像・スクリプトは相対URLを使い、GitHub Pagesの`/keroct-web/`配下でも動作します。

## ローカル確認

Repositoryのルートから実行してください。Python 3の標準機能を使います。

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory .
```

`http://127.0.0.1:8765/`を開きます。停止はこのコマンドのターミナルで`Ctrl+C`です。ポートが使われている場合は別のポートを指定してください。別の作業環境のサーバーを停止する必要はありません。

## 作品の追加

画像は`assets/works/<creator>/`に配置します。制作例の`article.work`には画像・タイトル・制作カテゴリ・作者ページへのリンクを持たせています。カテゴリは`data-category`、拡大画像と見出しは`data-image`と`data-title`で指定します。本人の作品とクライアント名の対応は、元の提供画像に基づいています。

提供された画像6点は原本のまま収録しています。キャラクター画像は提供イラストとして掲載し、本人コメントは素材を受け取った後に追加します。

## 共有するUI

各ページは`assets/style.css`と`assets/site.js`を利用します。配色はCSSの役割別変数で管理し、システムの配色設定を初期値として、メニュー内の「配色」から切り替えられます。選択はブラウザに保存されます。画像の拡大と相談窓口には標準の`dialog`を使い、Escapeでも閉じられます。

## チャットを接続する

現在、tawk.toはこれから用意する段階です。相談ボタンは受付準備中の案内を表示します。

KEROCTのPropertyとWidgetを用意したら、`assets/site-config.js`に正式なIDを設定します。設定後は相談ボタンからtawk.toを読み込んで開きます。読み込み中・失敗時の案内があります。IDが空の間はtawk.toへの通信を行いません。

## 公開前に整える内容

- ロゴプランCの内訳（提供本文と料金表画像の差分）
- 本人のプロフィール文・本人コメント、他クリエイターの素材
- tawk.toのProperty・Widget、スタッフ、受付運用
- 掲載作品とSNSリンクの最終確認

GitHub Pagesの公開は、`main`への統合と分離した手動操作で行います。リポジトリのSettings → Pages → Sourceを`GitHub Actions`へ切り替える前に、`github-pages` Environmentの保護ルールを確認してください。切替後、`main`へ統合済みの公開対象をActionsの`Publish GitHub Pages`から`Run workflow`で実行してください。workflowはmainからの手動起動だけを対象にし、main以外からの起動はskipします。起動時のcommit SHAを固定し、既存Webページと画像・関連ディレクトリだけを静的ファイルとして公開します。mainへの統合だけでは公開されません。PagesのSource切替はリポジトリ設定の変更であり、このworkflowは実行しません。

## 料金の更新

`data/pricing.json`が料金と制作条件の正本です。変更後はRepositoryルートで次を実行すると、専用ページとトップの導線を更新できます。

```powershell
python scripts/render-pricing.py
```

提供された2026年10月1日・2日の案内を転記しています。ミニ色紙はユーザー確認により画像の¥20,000を採用しました。スケジュール表の重複は一つにまとめています。税区分の記載は提供資料にありません。

## Windows配信向け補助機能

OBS Studioの起動中だけtawk.to Desktopの音声セッションをミュートする補助機能を追加しています。導入、削除、read-only診断、復元規則、制限、テストは [Windows音声ガードのREADME](tools/windows/obs-tawk-quiet/README.md) を参照してください。Webサイトとは独立した任意導入のツールです。
