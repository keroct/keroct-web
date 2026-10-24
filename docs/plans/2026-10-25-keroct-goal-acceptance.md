# keroct：元57事項の終了条件と残受入

移管元: [fridge PR #10](https://github.com/tept-creator/fridge/pull/10)（元head `609fc7dc5c1b8646d4442814a87a55047129dcae`）。
移管統括: [fridge #13の計画](https://github.com/tept-creator/fridge/blob/main/docs/plans/2026-10-24-fridge-13-update-contract.md)。

## 目的・正本・担当

この責務に属する1事項の元ID・到達条件・6工程・判断・証拠・依存を引き継ぎ、ほかの製品の残件と分けて完了判定する。製品の仕様・実装・受入を扱う既存計画とPRは各実体を正本として維持し、本計画は元F番号の終了条件への対応と残受入を管理する。

移管統括はfridge #13の担当。この計画の進行担当は、以後本責務の担当として引き継ぎ、製品内の既存実装担当・承認範囲を維持する。本ファイルがmainに揃い、fridge #13に切替完了を記録した後は、本責務のF番号の更新先をここ一つにする。それまでは旧PR10を現行正本とする。

## 引き継ぐ工程と現在性

- [x] 元ID F20 を一意に引き継ぐ。
- [x] 6工程、終了条件、旧判断、証拠リンクと後続依存を保持。
- [ ] 各事項は、下の6工程と到達条件に対する最新の証拠で個別に終了を判断する。

下の元行・工程表・根拠本文は2026-10-19までの受理記録であり、今回の移管で完了checkを変更していない。全体19/57は当時のcheckpointとして[原文archive](https://github.com/tept-creator/fridge/blob/main/docs/archive/2026-10-09-cross-repository-goal-plan.md)に保全する。2026-10-25の参照状態の一次照合を以下に分けて記録し、Issue closeやPR mergeだけで実受入・本番・保持条件を完了に換算しない。移管自身の終了と元F事項の終了は、それぞれの条件で判断する。

既存の進行中計画・実装PR・公開待ちを、本移管を理由に再開・統合・公開した扱いにしない。部分成果と未確認・対象外の理由は、元の6工程の根拠を維持して更新する。

## 2026-10-25の参照状態（一次照合）

| 参照先 | GitHub状態 | merge/close時刻（UTC） |
|---|---|---|
| 本責務の参照先 | 下の固定証拠と個別受入条件で継承 | — |

## 元の条件・6工程・根拠

## F20

| 元ID・終了 | 元入口・束 | 到達条件 | 旧記録の状態・証拠 | 残条件・依存 |
|---|---|---|---|---|
| F20 [ ] | `items/keroct/Pages公開対象の必要性整理.md` → K1 | 採用43pathの公開URL/配布archive/OGP資産と必要性根拠が成立 | PR12固定head e90fae8と現main f246c9b/tree08041afdの一致を照合。50sourceの配布ZIP全byte一致、selector6pass/1skip、実toolコンパイル/24policy、4HTML/113相対参照/JPEG1200x630/loopback MIMEを受入。[固定監査](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/README.md)。 | [43file ZIP/実生成・126参照/HTTP全43byte](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/pages-candidate-receipt.json)まで成立。実symlink skip/Linux/候補全体の独立受理/既知外部consumerと承認後の公開URL/byte/MIME受入が残る。本人Pages公開保留を維持。Gem調査の意図しない共有設定1fileは証拠保全し元の不存在へ復元済み。 |

| 元項目 | 成果物 | 自動検証 | 独立レビュー・main | 実機受入 | 本番 | その他 |
|---|---|---|---|---|---|---|
| [F20](https://github.com/keroct/keroct-web/blob/main/docs/plans/2026-10-25-keroct-goal-acceptance.md#stage-f20) | 完了 | 完了 | 進行中 | 待ち | 待ち | 待ち |

<a id="stage-f20"></a>

**F20** — [元実体1](https://github.com/keroct/keroct-web/issues/11) / [元実体2](https://github.com/keroct/keroct-web/pull/10)

- 1. 成果物作成: **完了** — [候補証拠](https://github.com/tept-creator/fridge/blob/main/docs/archive/2026-10-09-cross-repository-goal-plan.md#f20-candidate-evidence)で50source ZIPと43pathの必要性を照合。実Jekyllの3生成物を含む[43file Pages ZIP](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/keroct-web-f246c9b-pages-43.zip)を保存し、展開全byte一致・6HTML/126ローカル参照欠落0を確認。
- 2. 自動検証: **完了** — 配布ZIP50fileのGit byte一致、既存selector6pass/1skip、実toolコンパイル/24policy・GUI subsystem、3Python parse、4HTML/113参照、実JPEG1200x630/loopback MIME成立。実Jekyll53→43選択/ZIP展開byte、6HTML/126ローカル参照欠落0、JS2構文、loopback全43件200/byte一致・HTML/JPEG MIMEが成立。匿名fallbackの参照不一致とsandbox HTTP失敗を解消。2026-10-19の隔離Linux selector7pass/0fail/skip0・exit0で実symlink拒否を確認（[原ログ](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/selector-linux-20261019.raw.log)・[receipt](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/selector-linux-20261019-receipt.json)）。基準b51196cのK1原条件と追補前の正本8fd734cを照合し、旧selector実symlink skip/Linuxの残りを本7件で充足した。既受理の実Jekyll43path/byte/参照/HTTP・native24policy等と合わせ自動工程を完了とする。Linux Actions executionは未観測の来歴として保持し、新たな必須gateにはしない。公開後URL/archive/consumerは工程4–6で引き続き待ち。
- 3. 独立レビュー・main統合: **進行中** — PR12固定head e90fae8と実main f246c9bのtree08041afd一致を読返し。自動summary Completedは記録し、候補全体の独立受理・公開受入へ継承しない。
- 4. 実機・利用者受入: **待ち** — Pages保留解除・対象公開承認は本人。
- 5. 本番反映・本番確認: **待ち** — 承認後の手動公開、archive/URL/asset/SHA受入が必要。
- 6. その他の残条件: **待ち** — 公開後受入を終端条件として保持。

<a id="f20-candidate-evidence"></a>

#### F20 KEROCT固定候補・source配布・実Jekyll生成記録

[根拠/旧51→43の差/必要性](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/README.md)・[全hash/原ログreceipt](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/receipt.json)。main f246c9b/tree08041afdはPR12 head e90fae8とtree一致。全50sourceのZIPをGit canonical byteで生成・復元確認し、元feature/primaryを変更していない。43選定はsite24/tool19、うち40sourceが存在し、生成テーマCSS/ツールindex/VERIFICATION HTMLの3件は、追補の保存済み実Jekyll成功ログで生成を確認した。43選択fileの全byteが生成先と一致する。

新たにselector6pass/1skip（実symlink権限）、source ZIPからBuild/Test24policyとGUI subsystem、4HTMLの113相対参照、JPEG1200x630、loopback5URLのbyte/200/MIMEを確認し終了。公開HTTPや実音声/Task Schedulerの受入ではない。既存のPR12 Windows Jekyll53→43成功報告と今回の原ログ未回収を区別する。初回はRuby3.3.12展開/100gem hash照合まで。その後の保存済みログではタスク内の分離compiler/追加2gemを含む102gemのinstall成功と実build exit0が成立。[追補](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/generation-record.json)へ分け、Linux/公開環境の実績へ継承しない。Gem dry-runのhookが作成した共有default gemrc1fileは、生成byte/作成時刻/排他的作成元を確認・保全し、元の不存在へ戻した。

[43file Pages ZIPと現receipt](https://github.com/tept-creator/fridge/blob/main/docs/reviews/goal-f20-20261015/pages-candidate-receipt.json)を保存した。匿名fallbackのCSS参照不一致はタスク内のdotcom/SSL設定で生成し直し、6HTML/126ローカル参照/生成CSS接続・JS2構文・ZIP全byte・HTTP43件を受入。source50file ZIPと区別する。本人Pages公開保留を維持し、実symlink skip/Linux・候補全体の独立受理/外部consumer・承認後公開のbyte/MIME/SHA受入を残す。
