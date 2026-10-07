# OBS / tawk.to Desktop 音声ガード（Windows）

OBS Studioの `obs64.exe` が現在のWindowsログインセッションで動いている間、指定したtawk.to DesktopのAudio Sessionをミュートします。OBSの終了・クラッシュによるプロセス消失後、管理開始時のミュート状態へ戻します。元からミュートだったセッションはミュートを維持します。

Windows 10/11の64bit向けです。Windows標準.NET Framework 4.x、Windows PowerShell 5.1、Task Schedulerを使います。追加パッケージ、管理者権限、外部GUI音量ツールは必要ありません。組織のポリシーでタスク登録やスクリプトが禁止されている場合は、診断結果を管理者へ相談してください。

## 導入

リポジトリをダウンロード・展開して、このフォルダーの **Install.cmd** をダブルクリックします。tawk.to Desktopが起動していて実行ファイルが一意に見つかれば自動選択します。見つからない場合はファイル選択画面で実際の `tawk.to.exe`（または `tawk.exe` / `tawk.to Desktop.exe`）を選びます。ショートカットの「リンク先」から場所を確認できます。

この1回の操作で、ローカルコンパイル、`%LOCALAPPDATA%\KEROCT\ObsTawkQuiet` への配置、現在のユーザーのログイン時タスク登録、監視開始を行います。ログイン時はGUI subsystemのEXEを直接実行し、PowerShell/cmdのウィンドウを開きません。導入・診断・削除の操作時には結果確認用のコンソールが表示されます。

CLIで明示する場合（リポジトリルートから）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\obs-tawk-quiet\Manage.ps1 -Action Install -TawkExecutablePath 'C:\実際のインストール先\tawk.to.exe'
```

`ExecutionPolicy Bypass` はそのPowerShellプロセスだけです。恒久設定は変更しません。署名済みの配布EXEはまだ提供しておらず、確認したソースをローカルでビルドします。

既存の導入先への上書きは行いません。更新やtawk.toのインストール先変更は、先にUninstallしてから再導入してください。同じ実行ファイルを使うElectronの子プロセスも完全パスで一致すれば対象になります。別の実行ファイル名・共有ブラウザ・Windowsのシステム通知が音源の場合は対象にしません。

## 状態・診断（read-only）

導入先、またはソースフォルダーの **Status.cmd** を開きます。音量、タスク、監視状態を変更しません。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\obs-tawk-quiet\Manage.ps1 -Action Status
```

出力はJSONです。`ScheduledTaskRegistered` / `TaskState`、実在する `MonitorProcesses`、`Live.ObsDetected`、`Live.TawkProcesses`、`Live.AudioSessions`、`Live.OwnedSessions`、最後の監視状態・エラーを確認できます。`MonitorState.State.ManagingMute` は管理記録の有無です。消えたセッションの再生成に備えた基準値も含みます。`ConservativeSessionCount` はクラッシュ後の慎重な扱いになっている記録数です。

heartbeatは状態変化時と約5秒ごとに更新します。古いheartbeatだけでは稼働を判断せず、実在する監視プロセスと日時も確認してください。問い合わせ前に音を鳴らしていないtawk.toにはセッションがまだ存在しないことがあります。

## 削除

導入先、またはソースフォルダーの **Uninstall.cmd** を開きます。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\obs-tawk-quiet\Manage.ps1 -Action Uninstall
```

マニフェストのGUID・所有者SID・パスと、登録タスクの実行先・引数・説明・SIDを照合します。一致するタスクだけを無効化し、インストール固有のnamed eventで監視に復元・終了を依頼します。PIDによる強制終了は行いません。復元に失敗して管理記録が残った場合、配置物を保持して診断可能にします。タスクが無効化されたこともエラーに明示します。

停止できたらそのタスクと既知の配置ファイルだけを削除します。未知のファイルを追加していた場合は、そのファイルとディレクトリを保持します。配置先とその親のreparse pointを拒否し、再帰削除を使いません。utilityがクラッシュしていた場合は記録を慎重に解消し、勝手にunmuteしません。

## 動作と復元規則

- Core Audioの全active render endpointを走査し、対象PID・実行ファイル完全パス・プロセス起動時刻・セッションinstance identifierを確認します。書込み直前にも同一性を再確認します。システム音・複数プロセス共有セッションは操作しません。
- `ISimpleAudioVolume.SetMute` だけを呼びます。Windows master volume、音量の数値、OBS、Discord、ゲーム、ブラウザのセッションは操作しません。
- 1秒ごとの待機ベースの監視です。tawk.toがいないときは音声セッション走査も省略します。多重起動はインストール固有のmutexとタスク設定で抑止します。
- ミュート前に元状態をatomicなjournalへ保存します。保存に失敗したらミュートしません。切断・API失敗時は対象外への操作に切り替えず、復元可能な記録を保持します。
- OBS中の後発tawk.to、プロセス再起動、セッション再生成、複数セッションを追跡します。Windowsが一時muteを新セッションへ引き継ぐため、同じ出力先・実行ファイルで旧新が一対一なら現在の監視で保存した基準値を引き継ぎます。OBS終了と再生成が同じポーリング間隔に起きた場合も復元します。
- 旧新の対応が多対多などで曖昧な場合、新しいセッションの観測値を基準とします。誤ってunmuteするよりmuteを維持する側に倒します。
- utilityの正常停止・Uninstallは可能な限り復元します。強制終了・PC電源断をまたいだ記録は、その間のユーザー操作が判別できないため自動unmuteしません。Windows音量ミキサーでtawk.toの状態を確認してください。次の正常な監視期間では、その状態を新しい基準とします。

## 制限

検知には通常最大約1秒＋処理時間かかります。セッションを作った直後の最初の通知音や、OBS検知より前に出た音の混入を完全には保証できません。配信前にtawk.toを起動し、OBS起動後にStatusでミュートを確認してください。OBSは「配信開始」ではなく「起動」中を条件とします。

監視中に手動unmuteしても、OBSが起動していれば次の検知でmuteへ戻します。ユーザーが既にmuteのセッションに再度muteを指定した意図はCore Audioから区別できないため、元状態の復元規則を優先します。音量の恒久設定変更はOBSとutilityの停止後に行ってください。

現在のログインセッションで音量操作できるtawk.toだけが対象です。別ユーザー、別Windowsセッション、権限が異なりプロセスの完全パスを読めない場合は操作せず診断エラーを出します。出力機器切替・切断により消えたセッション自体へ復元はできません。記録・診断にローカル実行ファイルパスとPIDを含みます。外部への送信は行いません。

## 開発・検証

APIに依存しない `src/Policy.cs`、Windows依存の `src/CoreAudio.cs`、常駐/診断/協調停止の `src/Program.cs`、導入経路の `Manage.ps1` に分けています。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\obs-tawk-quiet\Test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\obs-tawk-quiet\WindowsIntegration.ps1
```

Testはコンパイルと状態遷移テスト、windowless EXEのPE subsystem確認を行います。WindowsIntegrationは明示実行の実機テストです。無音PCMを出す専用 `tawk.to.exe` fixtureと `obs64.exe` fixtureを一時生成し、同じ本番コードでmute/復元、後発起動、再起動、協調停止、utilityクラッシュ後の慎重な復元を試します。さらに専用GUIDのテスト用Scheduled Taskを実際に登録・実行・削除します。実OBSが起動中ならテスト開始を拒否します。fixtureだけをテストコードが終了させます。

実際のtawk.to DesktopとOBSによる最終確認は、StatusとWindows音量ミキサーを併用して、通常状態→OBS起動→tawk.toだけmute→OBS終了→元状態、元mute維持、再起動、ログイン時自動起動、Uninstall後の残留なしを確認してください。

API仕様： [SetMute](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-isimpleaudiovolume-setmute)、[GetProcessId](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid)、[GetSessionInstanceIdentifier](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getsessioninstanceidentifier)。
