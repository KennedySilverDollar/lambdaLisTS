Contrast の nested プロトタイプを作る。目的は「動くものを早く見ること」。検証の厳密さは要らない。

# このタスクでの CLAUDE.md の扱い
- 「作業対象は contrast-core だけ」「unwrap 禁止」「Kani 必須」などの規則は、このタスクでは適用しない。
- 破壊的操作の禁止は適用する（rm、git reset、git checkout、git restore、git push、既存ファイルへの > での上書きはしない）。
- crates/contrast-core は変更しない。読んで使うだけ（Point, Size, Rect, split_columns など）。
- unwrap や expect、panic は使ってよい。プロトタイプなので、見つけやすく落ちるほうが良い。

# 最初に読む（読み取りのみ）
docs/architecture.md、docs/cdl-contract.md、docs/core-spec.md の 1〜3 節、
crates/contrast/src/main.rs、crates/contrast-policy/src/ の 3 ファイル、ルートの Cargo.toml と src/main.rs。
読んだ結果から、「既存のソースをどう使うか」を 5 行で報告してから作業に入る。
既存の設計と食い違う判断が必要なら、docs/architecture.md を優先する。

# 作るもの（この順に、1 つ作るたびに動かして確認し、コミットする）
M1 nested の窓: `cargo run -p contrast` で、ホストの Wayland 上に winit のウィンドウを開き、
   その中で Wayland のソケット（WAYLAND_DISPLAY）を公開する。背景色で塗りつぶし、ソケット名をログに出す。
M2 クライアント表示: xdg-shell のトップレベルを受け付けて描画する。
   窓は contrast-core の `Rect::split_columns` で、出力いっぱいに横一列に並べる（窓が増減したら並べ直す）。
M3 入力: クリックでフォーカス移動。キーバインドは Alt+Return で端末を起動（環境変数 CONTRAST_TERMINAL、
   無ければ foot）、Alt+Q でフォーカス窓を閉じる、Alt+Left / Alt+Right でフォーカス移動、
   Alt+Shift+Q で終了。
M4 余力があれば: Alt+1〜4 のワークスペース切替（窓は各ワークスペースに属し、表示中のものだけ並べる）。
CDL の解析はしない。配置・キーバインドは静的な値でよい。ただし crates/contrast-policy の port.rs の差し込み口
（CDL をあとから接続できる形）は残し、static_policy を既定として使う。

# 進め方
- Smithay は crates.io の最新版を使う。API を推測せず、公式の example（smallvil や anvil）と docs.rs を読んで、
  それに合わせて書く。バージョンは Cargo.toml に固定する。
- 新しいクレートを作る場合は、ルート Cargo.toml の [workspace] members に足す。
  既存の crates/contrast と crates/contrast-policy に Cargo.toml が無ければ作る。
- 実行は `nix develop -c cargo build -p contrast`、`nix develop -c cargo run -p contrast` の形。
- flake.nix の devShell に、ビルドと実行に必要な物（wayland、libxkbcommon、libinput、mesa/libGL、
  seatd、pkg-config、udev など）と、必要なら LD_LIBRARY_PATH の設定を足してよい。追加だけにして、既存の記述は消さない。
  flake.lock は更新しない。足した内容は報告に書く。
- 画面は見られないので、動作確認は次の方法にする。コンポジタをバックグラウンドで起動し、
  ログからソケット名を取得して、`WAYLAND_DISPLAY=<ソケット名>` で `foot`（無ければ `weston-terminal` か
  `wayland-info`）を起動し、ログで窓の追加・配置の寸法・フォーカスが出ていることを確認する。
  終わったら起動したプロセスを止める。目視でしか確認できない点は、報告に「手で確認してほしいこと」として書く。
- コミットは `proto: <要約>`。push しない。ブランチは proto/nested のまま。

# やらないこと
- crates/contrast-core の変更、Kani、mutants、cargo-llvm-cov の導入。
- CDL の解析、設定ファイルの読み込み、レイヤーシェル、複数出力、DRM/KMS（ホストの Wayland 上で動かすだけ）。
- 破壊的操作、既存ファイルの上書き、push。

# 報告
1. どこまで動いたか（M1〜M4 のうち、どれが動作確認済みか）
2. 起動コマンドと、目視で確認する手順（キーバインド一覧を含む）
3. flake.nix に足した内容
4. 詰まった点と、決めて進めたこと
5. 次にやるべきこと（3 つまで）
