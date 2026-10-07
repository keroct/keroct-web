# 調査・検証記録（2026-10-07）

## Repository調査と配置判断

対象は `keroct/keroct-web`、baseは `e4a248c81922f2bed4463c4b807ee35bcb8e8607`。全追跡ファイルを確認した。HTML3ページ、共通CSS/JS、画像、料金JSON、Python料金生成、構想・料金出典の文書が既存構成。Windows tooling、install/setup/uninstall、バックグラウンド実行経路、自動テスト/CI、repository内のAGENTS/Rule/Skill/Hook、workspace adapterは存在しない。Git hookはsampleだけで、core.hooksPath指定もない。

WebからWindows audioを操作する構成にはせず、独立した任意導入ツールを `tools/windows/obs-tawk-quiet/` に配置。Webのコード・価格データ・生成規則は変更していない。既存READMEには入口だけを追加した。追加の外部パッケージやダウンロードコードは使用していない。

Graft CLIは環境に存在せず、MCPの索引はこのcheckoutを指していないため、全追跡ファイルと必要なソースの通常調査で補完した。索引の追加・初期化は行っていない。

## 自動検証

- `Test.ps1`: 本番monitor/CLIのビルド成功、policyの24 assertion成功、monitor PEのGUI subsystem確認成功。
- 状態遷移: 元unmute/mute、繰り返しpoll、後発起動、プロセス再起動、session再生成、複数session、消失、部分走査、復元失敗/再試行、journal書込み失敗、utility crash/restart、PID再利用で別appへの復元拒否、Windows mixer muteの一対一継承、多対多の慎重な扱い、OBS終了と再生成が同じpollに起きる場合。
- `WindowsIntegration.ps1`: 無音PCM fixtureによる実際のWindows Core Audio操作。通常状態、OBS名fixture検知、対象だけmute、OBSプロセス消失後の復元、元mute維持、後発tawk.to、再起動、utility正常停止時の復元、utility crash後に勝手にunmuteしないことを確認。
- 別の無音fixtureのAudio Sessionがunmuteのままであることを確認。
- 専用GUIDの実Scheduled Taskからwindowless monitorを起動、Statusで実processとtask稼働を確認、Statusによるconfig非変更を確認。
- タスクの説明をテストで変更し、ownership不一致でUninstallが拒否されることを確認。テスト後に同じ所有taskの設定を復元。
- 未知ファイルを配置してUninstallし、そのファイルが保持されることを確認。その後テスト自身のファイルを削除。所有task、process、配置ファイル・ディレクトリの残留なしを確認。

最終Windows統合実行はexit 0（約24秒）。1秒pollの監視CPU時間は5.009秒中234.375ms。この16論理CPU環境では全体の約0.29%相当（単一CPU換算では約4.7%）。機器数・プロセス数・PCにより変動する。同じ条件の実測は約172〜234ms/5秒だった。busy loopを使用せず、対象process不在時はaudio列挙を省略する。

既存Webの回帰検証では3ページのlocal links/fragments、ID重複、H1、6画像の原本hashを確認。`scripts/render-pricing.py` 再生成後の既存Webファイル差分はゼロ。`git diff --check` 成功。

## 実機検証の範囲

実際のtawk.to Desktop/OBS StudioはこのPCで起動しておらず、本番アプリの組み合わせによる通知音・配信への混入は未検証。fixtureは本番と同じCore Audio adapter、policy、monitor、installerを使用する。

Task Scheduler登録・実行・削除は実OSで検証したが、ログオフ/再ログインを実行する検証は行っていない。登録XMLの現在ユーザーSID、InteractiveToken、limited run level、AtLogOn trigger、直接EXE起動を確認した。

このCodex実行環境のAppData配置は、Task Scheduler側から見つからない状態（0x80070002）になった。失敗したテスト配置とtaskもUninstallで削除した。成功した実機テストはユーザーworkspace内の専用配置を使った。通常の利用者向け既定配置は `%LOCALAPPDATA%\KEROCT\ObsTawkQuiet` のまま。本番利用者の通常Windows環境での既定配置・ログイン時起動は最終確認項目。

ポーリング直後に作られたセッションの最初の音、音源がシステム通知/共有ブラウザにある場合、権限や別Windowsログインセッション、曖昧なsession再生成、utility強制終了をまたぐユーザー意図は完全には保証できない。READMEに動作・制限・確認手順を記載した。
