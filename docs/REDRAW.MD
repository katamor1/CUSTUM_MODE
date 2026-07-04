MFCアプリケーションで多数のコントロールを抱えるViewがある。このViewをCreateして、OnInitialUpdateすると、別プロセスで動作しているアプリケーションの描画がちらつく現象が発生した。この現象が発生するしくみと、対策を検討する

原因の候補がいくつかに分かれるタイプです。MFC固有の初期化順序、Win32の再描画、DWM/USER/GDIリソース負荷、そして「本当に別プロセスをInvalidateしている」ケースに分けて整理します。

思考時間: 24s

MFC の View を Create → OnInitialUpdate しただけで別プロセスのアプリまでちらつく場合、単純な「自Viewの描画が下手」というより、Win32 の再描画要求が大量発生して、Desktop Window Manager / USER / GDI 側に広範囲の再合成・再描画負荷をかけている可能性が高いです。

特に「多数のコントロールを抱える View」は、かなり起きやすいです。

1. 発生の基本メカニズム

MFC の CView::OnInitialUpdate() 内で多数の子コントロールを生成・初期化すると、各コントロールごとに内部的には次のような処理が発生します。

CreateWindowEx
  ↓
WM_CREATE
WM_NCCALCSIZE
WM_WINDOWPOSCHANGING
WM_WINDOWPOSCHANGED
WM_PARENTNOTIFY
WM_SIZE / WM_MOVE
WM_SETFONT
WM_SETTEXT
Invalidate / Erase / Paint
  ↓
WM_ERASEBKGND
WM_PAINT

これがコントロール数ぶん繰り返されます。

たとえば 300 個の子コントロールを OnInitialUpdate() で作ると、単純に 300 回の生成ではなく、

300個 × 複数メッセージ × 複数回の再配置 × 複数回の再描画

になります。

その結果、対象 View だけでなく、親 Frame、MDI Client、デスクトップ合成側にも大量の dirty region が発生します。

2. なぜ「別プロセスのアプリ」までちらつくのか

通常、別プロセスのウィンドウを直接描画しているわけではありません。

ただし Windows の画面表示は、各プロセスが独立に描いているように見えて、最終的には OS 側で合成されています。

自プロセスの View / Control
        ↓
USER / GDI
        ↓
DWM / Desktop Composition
        ↓
画面全体の合成結果

そのため、自プロセスが短時間に大量のウィンドウ生成・再描画・消去を発生させると、DWM や GDI 側の処理が詰まり、他プロセスのウィンドウも一瞬再合成待ち・再描画待ちのように見えることがあります。

特に次の条件が重なると、別アプリのちらつきとして見えやすいです。

View 作成中に親 Frame がすでに表示済み
子コントロールを WS_VISIBLE 付きで1個ずつ作成している
SetWindowText / SetFont / MoveWindow / ShowWindow を個別に大量実行している
InvalidateRect(..., TRUE) や RedrawWindow を広範囲に呼んでいる
UpdateWindow を途中で呼び、同期描画を何度も強制している
親 View が WM_ERASEBKGND で全面消去している
WS_CLIPCHILDREN / WS_CLIPSIBLINGS が不足している
GDI オブジェクト、USER オブジェクト、ウィンドウハンドル数が多すぎる
リモートデスクトップ、仮想環境、古いGPUドライバ環境で動作している
3. よくある直接原因
原因A: 子コントロールを表示状態で1個ずつ作っている

たとえばこういう初期化はちらつきやすいです。

m_edit1.Create(WS_CHILD | WS_VISIBLE | WS_BORDER, ...);
m_edit2.Create(WS_CHILD | WS_VISIBLE | WS_BORDER, ...);
m_combo.Create(WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST, ...);

各コントロール生成のたびに親 View の再描画領域が更新され、子ウィンドウも即座に描画対象になります。

対策は、非表示状態で作成して、最後にまとめて表示です。

m_edit1.Create(WS_CHILD | WS_BORDER, ...); // WS_VISIBLEなし
m_edit2.Create(WS_CHILD | WS_BORDER, ...);
m_combo.Create(WS_CHILD | CBS_DROPDOWNLIST, ...);

// 初期値設定、フォント設定、サイズ調整などを全部済ませる

m_edit1.ShowWindow(SW_SHOW);
m_edit2.ShowWindow(SW_SHOW);
m_combo.ShowWindow(SW_SHOW);

さらに理想は、親 View 自体も非表示または描画停止状態で初期化します。

原因B: OnInitialUpdate() 中に何度もレイアウトしている

ありがちなパターンです。

CreateControls();
SetControlFonts();
SetControlTexts();
ResizeControls();
LoadInitialData();
ResizeControls();
UpdateControlState();
Invalidate();
UpdateWindow();

この途中で MoveWindow や SetWindowPos が大量に呼ばれると、各コントロールごとに再配置・再描画が発生します。

対策は、レイアウト更新を一括化することです。

HDWP hdwp = BeginDeferWindowPos(count);

hdwp = DeferWindowPos(hdwp, hWnd1, NULL, x1, y1, w1, h1,
    SWP_NOZORDER | SWP_NOACTIVATE);

hdwp = DeferWindowPos(hdwp, hWnd2, NULL, x2, y2, w2, h2,
    SWP_NOZORDER | SWP_NOACTIVATE);

EndDeferWindowPos(hdwp);

MoveWindow を300回呼ぶより、BeginDeferWindowPos / DeferWindowPos / EndDeferWindowPos でまとめた方が安全です。

原因C: 親 View が子コントロール領域まで背景消去している

親 View の WM_ERASEBKGND が全面を塗ると、その後に子コントロールが再描画されます。

親Viewが背景を全面消去
  ↓
子コントロール領域も一瞬消える
  ↓
子コントロールが描き直す

これが典型的なちらつきです。

対策として、親 View に WS_CLIPCHILDREN を付けます。

BOOL CMyView::PreCreateWindow(CREATESTRUCT& cs)
{
    cs.style |= WS_CLIPCHILDREN;
    return CView::PreCreateWindow(cs);
}

兄弟コントロール同士の重なりがある場合は WS_CLIPSIBLINGS も検討します。

cs.style |= WS_CLIPCHILDREN | WS_CLIPSIBLINGS;

ただし WS_CLIPSIBLINGS は重なり前提のUIでは副作用が出ることがあるので、画面設計と合わせて確認が必要です。

原因D: InvalidateRect(NULL, TRUE) / RedrawWindow が広すぎる

以下のような呼び方は危険です。

InvalidateRect(NULL, TRUE);
UpdateWindow();

または、

RedrawWindow(NULL, NULL,
    RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW);

TRUE は背景消去を伴います。つまり WM_ERASEBKGND が発生しやすくなります。

対策は、初期化中は再描画を止め、最後に最小限の再描画にします。

SetRedraw(FALSE);

// 大量のCreate, SetFont, SetWindowText, MoveWindowなど

SetRedraw(TRUE);
Invalidate(FALSE);   // 背景消去を抑える

必要な場合だけ最後に、

RedrawWindow(NULL, NULL,
    RDW_INVALIDATE | RDW_ALLCHILDREN);

程度に留めます。

RDW_ERASE や RDW_UPDATENOW を乱用すると、同期描画が増えてちらつきやすくなります。

4. やってはいけない対策
LockWindowUpdate の乱用

LockWindowUpdate は一見効きそうですが、通常のちらつき対策にはあまり向きません。

特に、

LockWindowUpdate(GetDesktopWindow());

のような使い方は避けるべきです。

これは画面更新をかなり強引に止めるため、他プロセスの描画にも悪影響を出しやすいです。今回のような「別プロセスのアプリがちらつく」現象では、むしろ疑うべき対象になります。

UpdateWindow の多用

UpdateWindow() は未処理の WM_PAINT を即時処理させます。

初期化途中で何度も呼ぶと、

初期化
描画
初期化
描画
初期化
描画

のようになり、ちらつきやすくなります。

初期化中は描画を遅延させ、最後に1回だけ更新する方がよいです。

5. 推奨対策の優先順位
優先度1: Viewを非表示または描画停止状態で初期化する

一番効果が出やすいです。

void CMyView::OnInitialUpdate()
{
    CView::OnInitialUpdate();

    SetRedraw(FALSE);

    CreateControlsWithoutVisible();
    InitializeControlValues();
    LayoutControls();

    SetRedraw(TRUE);
    Invalidate(FALSE);
}

子コントロールにも必要に応じて WM_SETREDRAW を送ります。

m_list.SendMessage(WM_SETREDRAW, FALSE);

// 大量追加

m_list.SendMessage(WM_SETREDRAW, TRUE);
m_list.Invalidate(FALSE);

ListBox / ListCtrl / TreeCtrl / ComboBox などに大量データを入れる場合は特に有効です。

優先度2: WS_VISIBLE を外して作成し、最後にまとめて表示
DWORD style = WS_CHILD | WS_TABSTOP | WS_BORDER; // WS_VISIBLEなし

m_edit.Create(style, rect, this, IDC_EDIT1);

// 初期化完了後
m_edit.ShowWindow(SW_SHOW);

View全体が見えている状態で、子コントロールがパラパラ出現するのを防げます。

優先度3: WS_CLIPCHILDREN を付ける

View の背景描画が子コントロールを消してしまうのを防ぎます。

BOOL CMyView::PreCreateWindow(CREATESTRUCT& cs)
{
    cs.style |= WS_CLIPCHILDREN;
    return CView::PreCreateWindow(cs);
}

ダイアログ風の View、FormView、多数の子 HWND を持つ View ではかなり基本的な対策です。

優先度4: WM_ERASEBKGND を抑える

独自描画している View なら、背景消去を抑えます。

BOOL CMyView::OnEraseBkgnd(CDC* pDC)
{
    return TRUE;
}

ただし、背景をまったく塗らないとゴミが残る場合があります。自前の OnDraw / OnPaint で必要領域をきちんと描く前提です。

優先度5: レイアウト変更を一括化する

MoveWindow を大量に呼ぶのではなく、DeferWindowPos を使います。

HDWP hdwp = BeginDeferWindowPos(n);

for (...)
{
    hdwp = DeferWindowPos(
        hdwp,
        hWnd,
        NULL,
        x, y, w, h,
        SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOREDRAW);
}

EndDeferWindowPos(hdwp);

Invalidate(FALSE);

初期化中は SWP_NOREDRAW も候補になります。

優先度6: コントロール数そのものを減らす

多数の MFC/Win32 コントロールは、それぞれが独立した HWND です。

つまり、1000個のエディットボックスがあると、1000個の小さなウィンドウがあるということです。これは現代PCでもそれなりに重いです。

対策案は次の通りです。

表示中のページだけコントロールを作る
タブ切り替え時に遅延生成する
スクロール外のコントロールは作らない
グリッド系UIに置き換える
owner draw / custom draw に置き換える
設定項目をページ分割する
入力欄を仮想化する

大量の固定コントロールを一枚の View に全部ぶら下げる設計は、ちらつき・初期表示遅延・GDI/USERリソース消費の面で不利です。

6. 調査ポイント

現象確認では、次を見ます。

1. View 作成中に WM_ERASEBKGND / WM_PAINT が何回出ているか

Spy++ やログで確認します。

特に見るメッセージはこれです。

WM_CREATE
WM_SHOWWINDOW
WM_WINDOWPOSCHANGED
WM_SIZE
WM_MOVE
WM_ERASEBKGND
WM_PAINT
WM_NCPAINT
WM_SETREDRAW

OnInitialUpdate() 中に WM_PAINT が大量に出ているなら、初期化途中で描画が走っています。

2. InvalidateRect / RedrawWindow / UpdateWindow の呼び出し箇所

プロジェクト全体で検索します。

Invalidate
InvalidateRect
RedrawWindow
UpdateWindow
SetWindowPos
MoveWindow
ShowWindow
LockWindowUpdate
WM_SETREDRAW

特に次のような呼び方は要注意です。

InvalidateRect(NULL, TRUE);
RedrawWindow(NULL, NULL, RDW_ERASE | RDW_UPDATENOW | RDW_ALLCHILDREN);
UpdateWindow();
LockWindowUpdate(...);
3. USER/GDI オブジェクト数

タスクマネージャーの詳細タブで列を追加して確認できます。

GDI オブジェクト
USER オブジェクト
ハンドル数

View 作成時に USER オブジェクトが数百〜数千増えるなら、コントロール数そのものが主因の可能性が高いです。

7. 実装方針の例

一番無難な初期化パターンはこれです。

void CMyView::OnInitialUpdate()
{
    CView::OnInitialUpdate();

    SetRedraw(FALSE);

    CreateChildControlsHidden();
    SetChildFonts();
    SetChildInitialValues();
    LayoutChildControlsBatch();

    ShowChildControlsOnce();

    SetRedraw(TRUE);
    Invalidate(FALSE);
}

子コントロール作成時は、

WS_CHILD | WS_TABSTOP | ...

にして、初期化完了まで WS_VISIBLE を付けない。

View 側は、

BOOL CMyView::PreCreateWindow(CREATESTRUCT& cs)
{
    cs.style |= WS_CLIPCHILDREN;
    return CView::PreCreateWindow(cs);
}

を検討。

大量データ投入系は、

m_list.SendMessage(WM_SETREDRAW, FALSE);

// InsertItem / SetItemText 大量実行

m_list.SendMessage(WM_SETREDRAW, TRUE);
m_list.Invalidate(FALSE);

にする。

8. 原因切り分け用の最小実験

効果確認はこの順番がよいです。

OnInitialUpdate() の先頭と末尾に SetRedraw(FALSE/TRUE) を入れる
子コントロール作成時の WS_VISIBLE を外す
View に WS_CLIPCHILDREN を付ける
UpdateWindow() / RedrawWindow(...UPDATENOW...) を一時的に外す
Invalidate(..., TRUE) を Invalidate(FALSE) に変える
MoveWindow 多発箇所を DeferWindowPos に変える
コントロール数を半分にしたテスト View を作り、ちらつき量が比例するか確認する

この実験でちらつきが大きく減るなら、原因はほぼ「初期化中の大量再描画」です。

9. 結論

今回の現象は、おそらく次の流れです。

MFC View を作成
  ↓
OnInitialUpdate で大量の子コントロールを生成・初期化
  ↓
各コントロールが表示・移動・文字設定・フォント設定のたびに再描画要求
  ↓
親 View / Frame / DWM に大量の dirty region が発生
  ↓
画面合成が短時間に集中
  ↓
別プロセスのウィンドウもちらついて見える

対策の中心は、

初期化中は描画させない
表示は最後にまとめる
背景消去を減らす
レイアウトを一括化する
コントロール数を減らす

です。

最初に入れるべき対策は、かなり実務的にはこの3つです。

SetRedraw(FALSE);
WS_VISIBLE を外して Create し、最後に ShowWindow
WS_CLIPCHILDREN を View に付与

この3点だけでかなり改善する可能性があります。

SW_HIDE を入れても残るなら、「表示中Viewの通常ちらつき」より一段深いです。特に疑うべきは、非表示化のタイミング、UpdateWindow/RedrawWindow の同期描画、デスクトップ/全ウィンドウ対象のAPI、そしてリソース枯渇系です。

思考時間: 53s

それはかなり有力な追加情報です。
ShowWindow(SW_HIDE) しても残るなら、次のどれかの可能性が高いです。

Create の時点で一瞬表示・アクティブ化されている
ShowWindow(SW_HIDE) 自体が別ウィンドウをアクティブ化している
OnInitialUpdate 内で同期再描画や全体再描画を呼んでいる
LockWindowUpdate / desktop 対象の RedrawWindow など、他プロセスにも影響しうるAPIがある
大量 HWND / GDI / USER オブジェクト生成で DWM/USER/GDI が詰まっている

特に 1 と 2 が怪しいです。

まず疑うべき点

m_pMain->ShowWindow(SW_HIDE) は「初期化完了まで一切表示しない」対策としては、少し遅い可能性があります。

つまり、こうなっているかもしれません。

MainFrame Create
  ↓
この時点で WS_VISIBLE / Activate / Z-order 変更 / WM_SHOWWINDOW が発生
  ↓
一瞬だけ画面・他アプリの再描画に影響
  ↓
ShowWindow(SW_HIDE)
  ↓
別のウィンドウがアクティブ化される
  ↓
OnInitialUpdate

Microsoft の ShowWindow(SW_HIDE) の説明では、SW_HIDE は「ウィンドウを非表示にし、別のウィンドウをアクティブにする」動作です。つまり、SW_HIDE 自体が他プロセスのウィンドウの非クライアント領域、フォーカス枠、アクティブ状態の描き直しを誘発します。

なので、今回の狙いが「画面に一切影響させずに初期化する」なら、

Createしてから隠す

ではなく、

最初から表示状態にしない

に寄せるべきです。

推奨方針1: InitialUpdateFrame(pDoc, FALSE) を使う

MFC の CFrameWnd::InitialUpdateFrame は、内部の View に OnInitialUpdate を呼びます。第2引数 bMakeVisible が TRUE ならフレームを表示・アクティブ化し、FALSE なら子孫を表示しない扱いになります。

可能なら、次の流れにしてください。

CFrameWnd* pFrame = pTemplate->CreateNewFrame(pDoc, NULL);

// ここで ShowWindow(SW_HIDE) しない
// そもそも表示させない

pTemplate->InitialUpdateFrame(pFrame, pDoc, FALSE);

// OnInitialUpdate 完了後、最後に明示表示
pFrame->ShowWindow(SW_SHOW);
pFrame->UpdateWindow();

または CFrameWnd 直接なら、

pFrame->InitialUpdateFrame(pDoc, FALSE);

です。

重要なのは、ShowWindow(SW_HIDE) で後から隠すのではなく、bMakeVisible = FALSE で初期更新を通すことです。

推奨方針2: Create / LoadFrame のスタイルから WS_VISIBLE を除く

Create / CreateEx / LoadFrame に渡しているスタイルに WS_VISIBLE が入っていると、CreateWindowEx の時点で表示関係のメッセージが走る可能性があります。

確認対象です。

WS_OVERLAPPEDWINDOW | WS_VISIBLE

こうなっていたら危険です。

DWORD style = WS_OVERLAPPEDWINDOW;  // WS_VISIBLEなし

MFC の LoadFrame でも、デフォルトスタイルや派生クラス側で WS_VISIBLE を混ぜていないか確認してください。

pFrame->LoadFrame(
    IDR_MAINFRAME,
    WS_OVERLAPPEDWINDOW | FWS_ADDTOTITLE, // WS_VISIBLEなし
    NULL,
    pContext
);

この後に、

pFrame->InitialUpdateFrame(pDoc, FALSE);

を通し、最後だけ表示します。

推奨方針3: ShowWindow(SW_HIDE) より SetWindowPos(... SWP_NOACTIVATE ...)

どうしても作成直後に隠す必要がある場合は、ShowWindow(SW_HIDE) ではなく、アクティブ化副作用を避けるために SetWindowPos を検討します。

SetWindowPos には SWP_HIDEWINDOW と SWP_NOACTIVATE があり、SWP_NOACTIVATE はウィンドウをアクティブ化しない指定です。

::SetWindowPos(
    pFrame->GetSafeHwnd(),
    NULL,
    0, 0, 0, 0,
    SWP_HIDEWINDOW |
    SWP_NOACTIVATE |
    SWP_NOMOVE |
    SWP_NOSIZE |
    SWP_NOZORDER |
    SWP_NOREDRAW
);

ただし、これは応急処置寄りです。
本命はやはり 最初から WS_VISIBLE を付けない / InitialUpdateFrame(..., FALSE) にする です。

推奨方針4: OnInitialUpdate 中の同期再描画を全部洗う

フレームが非表示でも、次のような呼び出しがあると描画系メッセージや DWM/USER/GDI 負荷が増えます。

UpdateWindow();
RedrawWindow(...);
InvalidateRect(..., TRUE);
SetWindowPos(...);     // SWP_NOREDRAWなし
MoveWindow(..., TRUE);
ShowWindow(...);

特に危険なのはこれです。

RedrawWindow(NULL, NULL,
    RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW);

RDW_UPDATENOW は、対象ウィンドウに WM_NCPAINT / WM_ERASEBKGND / WM_PAINT を関数復帰前に処理させます。RDW_ALLCHILDREN は子ウィンドウも対象に含めます。

初期化中は、原則としてこれを避けます。

// 初期化中は避けたい
UpdateWindow();
RedrawWindow(... RDW_UPDATENOW ...);
RedrawWindow(... RDW_ERASENOW ...);
RedrawWindow(... RDW_ALLCHILDREN ...);

最後に表示するときだけ、必要最小限にします。

pFrame->ShowWindow(SW_SHOW);
pFrame->RedrawWindow(
    NULL,
    NULL,
    RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN
);

RDW_UPDATENOW は最終表示の直前・直後でも、まず外して比較した方がよいです。

推奨方針5: WM_SETREDRAW を親・View・重い子コントロールに入れる

ShowWindow(SW_HIDE) は表示状態の制御です。
大量初期化中の再描画抑止には WM_SETREDRAW の方が目的に合っています。

Microsoft も、複数項目を追加するようなケースでは WM_SETREDRAW(FALSE) → 追加 → WM_SETREDRAW(TRUE) → RedrawWindow という使い方を説明しています。

例です。

void CMyView::OnInitialUpdate()
{
    CView::OnInitialUpdate();

    SendMessage(WM_SETREDRAW, FALSE);

    CreateControlsHidden();
    InitializeControls();
    LayoutControls();

    SendMessage(WM_SETREDRAW, TRUE);

    // まだフレーム非表示なら、ここで無理に再描画しない
}

ListCtrl / TreeCtrl / ComboBox / ListBox などには個別にも入れます。

m_list.SendMessage(WM_SETREDRAW, FALSE);

for (...)
{
    m_list.InsertItem(...);
}

m_list.SendMessage(WM_SETREDRAW, TRUE);

ただし注意点として、WM_SETREDRAW(TRUE) を非表示ウィンドウに送ると、場合によっては WS_VISIBLE が戻る挙動があります。Microsoft の説明にも、WM_SETREDRAW(FALSE) は WS_VISIBLE を外し、TRUE は WS_VISIBLE を追加しうるとあります。
そのため、非表示フレームに対して乱暴に親から順番に TRUE を戻すと、意図せず表示状態が戻る可能性があります。

安全にやるなら、

bool bFrameShouldRemainHidden = !pFrame->IsWindowVisible();

pView->SendMessage(WM_SETREDRAW, TRUE);

if (bFrameShouldRemainHidden)
{
    pFrame->ShowWindow(SW_HIDE);
}

のように、最後の表示状態を再確認します。

推奨方針6: LockWindowUpdate を使っていないか確認する

これはかなり重要です。

もしどこかに、

LockWindowUpdate(...)

特に、

LockWindowUpdate(GetDesktopWindow());
LockWindowUpdate(NULL);

周辺の処理があるなら、今回の「別プロセスまでちらつく」現象にかなり関係しそうです。

LockWindowUpdate は一般的な再描画抑止用ではなく、Microsoft の説明でもドラッグ＆ドロップ等のフィードバック用途が主目的で、通常の再描画抑止には WM_SETREDRAW を使うべきとされています。

つまり、ちらつき対策として LockWindowUpdate を使っているなら、むしろ外した方がよいです。

切り分けログを入れる場所

まず、自プロセスの MainFrame / View にログを入れてください。

void CMainFrame::OnShowWindow(BOOL bShow, UINT nStatus)
{
    TRACE("MainFrame WM_SHOWWINDOW bShow=%d status=%u\n", bShow, nStatus);
    CFrameWnd::OnShowWindow(bShow, nStatus);
}

void CMainFrame::OnActivate(UINT nState, CWnd* pWndOther, BOOL bMinimized)
{
    TRACE("MainFrame WM_ACTIVATE state=%u other=%p minimized=%d\n",
          nState, pWndOther ? pWndOther->GetSafeHwnd() : NULL, bMinimized);
    CFrameWnd::OnActivate(nState, pWndOther, bMinimized);
}

void CMyView::OnPaint()
{
    TRACE("View WM_PAINT\n");
    CPaintDC dc(this);
    // ...
}

BOOL CMyView::OnEraseBkgnd(CDC* pDC)
{
    TRACE("View WM_ERASEBKGND\n");
    return CView::OnEraseBkgnd(pDC);
}

さらに OnWindowPosChanging/Changed で SWP_SHOWWINDOW / SWP_HIDEWINDOW / SWP_NOACTIVATE を見ます。

void CMainFrame::OnWindowPosChanged(WINDOWPOS* lpwndpos)
{
    TRACE("MainFrame WM_WINDOWPOSCHANGED flags=0x%08X\n", lpwndpos->flags);
    CFrameWnd::OnWindowPosChanged(lpwndpos);
}

見たいのはこの順番です。

Create直後に WM_SHOWWINDOW(TRUE) が出ていないか
Create直後に WM_ACTIVATE / WM_NCACTIVATE が出ていないか
OnInitialUpdate中に WM_PAINT / WM_ERASEBKGND が出ていないか
ShowWindow(SW_HIDE) 時に他ウィンドウへアクティブが移っていないか

もし Create 直後に WM_SHOWWINDOW(TRUE) が出ているなら、ShowWindow(SW_HIDE) は完全に遅いです。

かなり現実的な修正案

おすすめはこの形です。

BOOL CMyApp::CreateHiddenMainFrameAndInitialize()
{
    CCreateContext context;
    context.m_pCurrentDoc = pDoc;
    context.m_pNewViewClass = RUNTIME_CLASS(CMyView);
    context.m_pNewDocTemplate = pTemplate;

    CMainFrame* pFrame = new CMainFrame;

    DWORD style =
        WS_OVERLAPPEDWINDOW |
        FWS_ADDTOTITLE;

    // WS_VISIBLE は絶対に入れない
    if (!pFrame->LoadFrame(IDR_MAINFRAME, style, NULL, &context))
        return FALSE;

    m_pMainWnd = pFrame;

    // 表示しないまま OnInitialUpdate を通す
    pFrame->InitialUpdateFrame(pDoc, FALSE);

    // 必要ならここで初期化完了フラグ
    // pFrame->m_bInitialized = TRUE;

    // 最後に初めて表示
    pFrame->ShowWindow(SW_SHOW);
    pFrame->UpdateWindow();

    return TRUE;
}

View 側は、

void CMyView::OnInitialUpdate()
{
    CView::OnInitialUpdate();

    SendMessage(WM_SETREDRAW, FALSE);

    CreateControlsHidden();     // WS_VISIBLEなし
    SetFonts();
    SetTexts();
    LoadData();
    LayoutControlsBatch();

    ShowControlsOnce();         // 最後にまとめて表示

    SendMessage(WM_SETREDRAW, TRUE);

    // ここで UpdateWindow は呼ばない
    // ここで RedrawWindow(...UPDATENOW...) も呼ばない
}

子コントロール作成も、

DWORD style = WS_CHILD | WS_TABSTOP | WS_BORDER; // WS_VISIBLEなし
m_edit.Create(style, rect, this, IDC_EDIT);

最後だけ、

m_edit.ShowWindow(SW_SHOW);

です。

追加で見るべき検索キーワード

プロジェクト全体で以下を検索してください。

WS_VISIBLE
ShowWindow
UpdateWindow
RedrawWindow
Invalidate
InvalidateRect
LockWindowUpdate
SetWindowPos
MoveWindow
SetFocus
SetActiveWindow
BringWindowToTop
SetForegroundWindow
HWND_DESKTOP
GetDesktopWindow
HWND_BROADCAST
WM_SETREDRAW

特にアウトなのはこの系統です。

RedrawWindow(GetDesktopWindow(), ...);
RedrawWindow(NULL, ... RDW_ALLCHILDREN ...);
LockWindowUpdate(GetDesktopWindow());
SetForegroundWindow(...);
BringWindowToTop(...);
ShowWindow(SW_HIDE); // Create直後に毎回実行
結論

今回の追加情報から見ると、ShowWindow(SW_HIDE) は方向性としては近いですが、まだ不十分です。

一番怪しいのはこれです。

Create時点で一度表示・アクティブ化されている
または
ShowWindow(SW_HIDE) 自体が別プロセスをアクティブ化して再描画させている

対策は、優先順にこうです。

1. Create / LoadFrame から WS_VISIBLE を完全に外す
2. InitialUpdateFrame(pDoc, FALSE) で OnInitialUpdate を通す
3. ShowWindow(SW_HIDE) に頼らない
4. OnInitialUpdate 中の UpdateWindow / RedrawWindow(UPDATENOW/ERASE/ALLCHILDREN) を外す
5. LockWindowUpdate / desktop対象RedrawWindow を全検索する
6. 子コントロールは WS_VISIBLEなしで作り、最後にまとめて表示

まずは WM_SHOWWINDOW(TRUE) が OnInitialUpdate 前に出ていないかログで確認するのが、いちばん早いです。ここで出ていたら、ほぼ勝ち筋が見えます。

現状の構成は、メインフレームはもともとメニューバーしか所持しておらず、起動時に読み込んだ仕様設定ファイルの内容で、画面数と画面種類を決定して動的に生成するので、以下のような構成になっています

    m_pMainWnd->ShowWindow(SW_HIDE);
    for(auto p : specStatus)
          if(p->m_bEnable)
          {
                m_viewPtr.push_back(new CmyView(this, p->m_i2Kind));
                m_viewPtr[i]->Create();
                m_viewPtr[i]->Oninitialupdate();
           }
    m_pMainWnd->ShowWindow(SW_SHOW);
    m_pMainWnd->UpdateWindow();　

この擬似コードを見ると、かなり核心に近いです。OnInitialUpdate() を手動で呼んでいる点と、View を複数まとめて Create して保持する構成が、MFC の通常ライフサイクルから外れていて副作用を生みやすいです。

思考時間: 29s

この構成だと、残るちらつきの主因はかなり絞れます。

一番大きいのは、メインフレームを一度 Hide/Show していることと、各 View の Create() / OnInitialUpdate() を手動で連続実行していることです。

特にこの部分です。

m_pMainWnd->ShowWindow(SW_HIDE);

for (auto p : specStatus)
{
    if (p->m_bEnable)
    {
        m_viewPtr.push_back(new CmyView(this, p->m_i2Kind));
        m_viewPtr[i]->Create();
        m_viewPtr[i]->Oninitialupdate();
    }
}

m_pMainWnd->ShowWindow(SW_SHOW);
m_pMainWnd->UpdateWindow();

SW_HIDE は単に「見えなくする」だけではなく、別のウィンドウをアクティブ化する動作を伴います。Microsoft の ShowWindow の説明でも、SW_HIDE は “Hides the window and activates another window” とされています。つまり、自アプリを隠した瞬間に、背後の別プロセスのウィンドウがアクティブ化され、その非クライアント領域やフォーカス状態が再描画されます。これだけでも「別プロセス側がちらつく」原因になります。

まず結論

この構成なら、対策の優先順位はこうです。

1. 起動時に m_pMainWnd を一度も表示しない
2. ShowWindow(SW_HIDE) → 初期化 → ShowWindow(SW_SHOW) という往復をやめる
3. View::Create() では WS_VISIBLE を絶対に付けない
4. OnInitialUpdate() を手動で呼ばず、専用の初期化関数に分離する
5. 最初に表示する View だけを最後に Show する
6. 他の View は可能なら遅延生成する

一番重要なのは、**「表示してから隠す」ではなく「最初から表示しない」**です。

現状構成で起きていそうなこと

おそらく現在はこうなっています。

メインフレーム作成
  ↓
一度表示状態またはアクティブ状態になる
  ↓
ShowWindow(SW_HIDE)
  ↓
背後の別プロセスウィンドウがアクティブ化・再描画
  ↓
多数の View / 子コントロールを Create
  ↓
非表示でも invalid region / layout / USER/GDI 処理は大量発生
  ↓
ShowWindow(SW_SHOW)
  ↓
自アプリが再アクティブ化
  ↓
UpdateWindow で同期描画
  ↓
別プロセス側も含めてちらついて見える

つまり、SW_HIDE にしたことで「View の中身」は見えなくなっていても、ウィンドウのアクティブ化・Z順変更・最終 Show・同期描画は残っています。

問題1: ShowWindow(SW_HIDE) を使っている

今回の用途では、SW_HIDE はあまり相性がよくありません。

m_pMainWnd->ShowWindow(SW_HIDE);

これは「まだ見せない」ではなく、すでに存在するウィンドウを隠して、他のウィンドウをアクティブにする処理です。

今回やりたいのはこれではなく、

最初から表示ウィンドウとして作らない

です。

したがって、まず確認すべきはメインフレーム作成時のスタイルです。

WS_VISIBLE

が入っていないか確認してください。

例えば LoadFrame / Create / CreateEx のどこかで、

WS_OVERLAPPEDWINDOW | WS_VISIBLE

になっていたら、SW_HIDE では遅いです。

理想はこうです。

DWORD dwStyle = WS_OVERLAPPEDWINDOW | FWS_ADDTOTITLE;
// WS_VISIBLE は入れない

pMainFrame->LoadFrame(IDR_MAINFRAME, dwStyle, NULL, pCreateContext);

その後、初期化が全部終わるまで ShowWindow しません。

問題2: 最後の ShowWindow(SW_SHOW) もアクティブ化する

最後のこれも注意です。

m_pMainWnd->ShowWindow(SW_SHOW);

SW_SHOW はウィンドウを表示し、通常はアクティブ化します。初回表示としては普通ですが、ちらつき切り分けでは SW_SHOWNOACTIVATE や SW_SHOWNA で比較する価値があります。ShowWindow の定義では SW_SHOWNOACTIVATE はアクティブ化せずに表示する指定です。

切り分け用にはこうします。

m_pMainWnd->ShowWindow(SW_SHOWNOACTIVATE);
// または
m_pMainWnd->ShowWindow(SW_SHOWNA);

これで別プロセス側のちらつきが減るなら、原因はかなり アクティブウィンドウ切り替え由来です。

本番ではアプリを前面に出したいでしょうから、最終的には SW_SHOW でもよいですが、原因切り分けとしては強力です。

問題3: UpdateWindow() が同期描画を強制している

最後のこれもちらつきの増幅要因です。

m_pMainWnd->UpdateWindow();

UpdateWindow() は、溜まっている WM_PAINT をその場で処理させます。
大量の View と大量の子コントロールを作った直後だと、ここで一気に描画が走ります。

まずは比較実験として、外してください。

m_pMainWnd->ShowWindow(SW_SHOW);
// m_pMainWnd->UpdateWindow();  // 一度外して確認

または、最後に必要最小限だけ再描画します。

m_pMainWnd->Invalidate(FALSE);

RedrawWindow を使う場合も、RDW_UPDATENOW / RDW_ERASENOW / RDW_ALLCHILDREN は初期表示直後の切り分けでは避けた方がよいです。RedrawWindow の RDW_ERASE は WM_ERASEBKGND を発生させるフラグで、RDW_ALLCHILDREN は子ウィンドウも対象に含めます。

問題4: OnInitialUpdate() を手動で呼んでいる

ここはかなり気になります。

m_viewPtr[i]->Oninitialupdate();

MFC 的には、OnInitialUpdate() は普通、フレーム側の初期更新処理から呼ばれるものです。CFrameWnd::InitialUpdateFrame は、フレーム内のすべての View に属する OnInitialUpdate を呼ぶ関数として説明されています。

なので、手動で OnInitialUpdate() を呼ぶと、以下のような副作用が起きやすくなります。

MFC の想定する Document/View 初期化順序から外れる
View が ActiveView でない状態で初期更新される
親 Frame / Client 領域の RecalcLayout を途中で誘発する
各 View が個別に Resize / Invalidate / Update を走らせる
OnInitialUpdate が複数回呼ばれる事故が起きやすい

おすすめは、OnInitialUpdate() を「大量コントロール生成関数」として使わないことです。

代わりにこう分けます。

class CmyView : public CView
{
public:
    BOOL CreateViewWindow(CWnd* pParent);
    void BuildControls(const SpecStatus* pSpec);   // コントロール生成
    void InitializeData(const SpecStatus* pSpec);  // データ投入
    void FinalizeLayout();                         // レイアウト
protected:
    virtual void OnInitialUpdate();
};

そして起動時の大量生成では、

pView->CreateViewWindow(pParent);
pView->BuildControls(p);
pView->InitializeData(p);
pView->FinalizeLayout();

のようにし、OnInitialUpdate() は MFC の通常用途、または初回表示時だけに限定します。

問題5: 全 View を起動時に実 HWND として作っている

仕様ファイルで画面数と画面種類が決まる構成自体は自然です。
ただし、起動時に有効な全画面を全部 Create() する設計は、ちらつきや USER/GDI 負荷の面では重いです。

今の構成はこうです。

仕様ファイル読み込み
  ↓
有効な画面を全部 CView として new
  ↓
全部 Create
  ↓
全部 OnInitialUpdate
  ↓
最後に MainFrame 表示

これをできればこう変えたいです。

仕様ファイル読み込み
  ↓
画面定義だけ保持
  ↓
最初に表示する画面だけ Create
  ↓
MainFrame 表示
  ↓
画面切替時に必要な View を遅延 Create

つまり、m_viewPtr には最初から全部の CView* を入れるのではなく、まずは定義だけ持たせます。

struct ViewEntry
{
    SpecStatus* pSpec;
    int kind;
    bool created;
    CmyView* pView;
};

初期化時は、

for (auto p : specStatus)
{
    if (p->m_bEnable)
    {
        ViewEntry e;
        e.pSpec = p;
        e.kind = p->m_i2Kind;
        e.created = false;
        e.pView = nullptr;
        m_views.push_back(e);
    }
}

最初に必要な画面だけ作ります。

CreateViewIfNeeded(initialIndex);
ShowView(initialIndex);

遅延生成関数はこうです。

void CMainFrame::CreateViewIfNeeded(size_t index)
{
    ViewEntry& e = m_views[index];

    if (e.created)
        return;

    CmyView* pView = new CmyView(this, e.kind);

    pView->CreateViewWindow(this);      // WS_VISIBLEなし
    pView->SendMessage(WM_SETREDRAW, FALSE);

    pView->BuildControls(e.pSpec);
    pView->InitializeData(e.pSpec);
    pView->FinalizeLayout();

    pView->SendMessage(WM_SETREDRAW, TRUE);

    e.pView = pView;
    e.created = true;
}

この方式だと、起動時の USER/GDI 負荷がかなり下がります。

どうしても全 View を事前生成したい場合

その場合は、最低限こういう形にした方がよいです。

// MainFrame はそもそもまだ ShowWindow しない
// ここで SW_HIDE は呼ばない

m_pMainWnd->SendMessage(WM_SETREDRAW, FALSE);

for (auto p : specStatus)
{
    if (!p->m_bEnable)
        continue;

    CmyView* pView = new CmyView(this, p->m_i2Kind);
    m_viewPtr.push_back(pView);

    pView->CreateViewWindow(m_pMainWnd);       // WS_VISIBLEなし
    pView->SendMessage(WM_SETREDRAW, FALSE);

    pView->BuildControls(p);                   // 子コントロールも WS_VISIBLEなし
    pView->InitializeData(p);
    pView->FinalizeLayout();

    pView->SendMessage(WM_SETREDRAW, TRUE);

    // 非表示のまま保持
    pView->ShowWindow(SW_HIDE);
}

m_pMainWnd->SendMessage(WM_SETREDRAW, TRUE);

// 最初に見せる View だけ表示
m_viewPtr[initialIndex]->ShowWindow(SW_SHOW);

// MainFrame を最後に初めて表示
m_pMainWnd->ShowWindow(SW_SHOW);

// まずは UpdateWindow なしで比較
// m_pMainWnd->UpdateWindow();

WM_SETREDRAW は、ウィンドウ変更後の再描画を許可・禁止するためのメッセージです。大量の項目追加や大量の子コントロール初期化では、FALSE にして変更を行い、最後に TRUE に戻す使い方が目的に合います。

ただし、親フレームが非表示の状態で WM_SETREDRAW(TRUE) を戻すと、状況によっては表示状態との相互作用が分かりにくくなるので、最終的な ShowWindow は必ず最後に集約した方がよいです。

View::Create 側で必ず確認すること

CmyView::Create() の中がかなり重要です。
特にこのようなスタイルになっていないか確認してください。

WS_CHILD | WS_VISIBLE

初期化中は WS_VISIBLE を外します。

BOOL CmyView::CreateViewWindow(CWnd* pParent)
{
    DWORD style =
        WS_CHILD |
        WS_CLIPCHILDREN |
        WS_CLIPSIBLINGS;

    // WS_VISIBLE は入れない

    CRect rc(0, 0, 0, 0);

    return Create(
        NULL,
        NULL,
        style,
        rc,
        pParent,
        AFX_IDW_PANE_FIRST + m_kind,
        NULL
    );
}

子コントロール側も同じです。

DWORD style = WS_CHILD | WS_TABSTOP | WS_BORDER;
// WS_VISIBLE なし

m_edit.Create(style, rect, this, IDC_EDIT_XXX);

最後に表示するときだけ、

m_edit.ShowWindow(SW_SHOW);

です。

さらに重要: 全 View を同じ親にぶら下げるなら、表示対象以外は隠す

複数 View を同じ MainFrame / Client 領域に作る場合、全 View が WS_VISIBLE になると、重なった View がそれぞれ描画対象になります。

画面切替方式なら、常にこうします。

void CMainFrame::ShowOnlyView(size_t index)
{
    for (size_t i = 0; i < m_viewPtr.size(); ++i)
    {
        if (!m_viewPtr[i])
            continue;

        m_viewPtr[i]->ShowWindow(i == index ? SW_SHOW : SW_HIDE);
    }

    SetActiveView(m_viewPtr[index]);
}

ただし、切り替え時にもちらつくなら、SetWindowPos で SWP_NOREDRAW を使って一括切り替えする方がよいです。

現在コードの最小修正版

まずは大きく設計を変えず、最小変更で試すならこうです。

// ここで ShowWindow(SW_HIDE) はしない
// m_pMainWnd は最初から WS_VISIBLE なしで作っておくこと

m_pMainWnd->SendMessage(WM_SETREDRAW, FALSE);

for (auto p : specStatus)
{
    if (!p->m_bEnable)
        continue;

    CmyView* pView = new CmyView(this, p->m_i2Kind);
    m_viewPtr.push_back(pView);

    pView->CreateHidden();              // WS_VISIBLEなし
    pView->SendMessage(WM_SETREDRAW, FALSE);

    // OnInitialUpdate の代わりに専用関数へ分離するのが望ましい
    pView->InitializeBySpec(p);

    pView->SendMessage(WM_SETREDRAW, TRUE);
    pView->ShowWindow(SW_HIDE);
}

m_pMainWnd->SendMessage(WM_SETREDRAW, TRUE);

// 初期表示する View だけ表示
if (!m_viewPtr.empty())
{
    m_viewPtr[0]->ShowWindow(SW_SHOW);
    SetActiveView(m_viewPtr[0]);
}

// 最後に初めて MainFrame を表示
m_pMainWnd->ShowWindow(SW_SHOW);

// まずはこれは外して比較
// m_pMainWnd->UpdateWindow();

さらに、OnInitialUpdate() を残すとしても、最低限こういうガードを入れます。

void CmyView::OnInitialUpdate()
{
    CView::OnInitialUpdate();

    SendMessage(WM_SETREDRAW, FALSE);

    // Create controls
    // SetFont
    // SetWindowText
    // MoveWindow
    // Load data

    SendMessage(WM_SETREDRAW, TRUE);

    // ここで UpdateWindow / RedrawWindow は呼ばない
}
最優先で確認するログ

以下をログに出すと、かなり早く原因が見えます。

void CMainFrame::OnShowWindow(BOOL bShow, UINT nStatus)
{
    TRACE("MainFrame WM_SHOWWINDOW bShow=%d status=%u\n", bShow, nStatus);
    CFrameWnd::OnShowWindow(bShow, nStatus);
}

void CMainFrame::OnActivate(UINT nState, CWnd* pWndOther, BOOL bMinimized)
{
    TRACE("MainFrame WM_ACTIVATE state=%u other=%p\n",
          nState,
          pWndOther ? pWndOther->GetSafeHwnd() : NULL);

    CFrameWnd::OnActivate(nState, pWndOther, bMinimized);
}

void CmyView::OnShowWindow(BOOL bShow, UINT nStatus)
{
    TRACE("View kind=%d WM_SHOWWINDOW bShow=%d\n", m_i2Kind, bShow);
    CView::OnShowWindow(bShow, nStatus);
}

BOOL CmyView::OnEraseBkgnd(CDC* pDC)
{
    TRACE("View kind=%d WM_ERASEBKGND\n", m_i2Kind);
    return CView::OnEraseBkgnd(pDC);
}

void CmyView::OnPaint()
{
    TRACE("View kind=%d WM_PAINT\n", m_i2Kind);
    CPaintDC dc(this);
}

特に見たいのはこれです。

OnInitialUpdate 前に MainFrame の WM_SHOWWINDOW(TRUE) が出ているか
SW_HIDE 時に WM_ACTIVATE が別ウィンドウへ移っているか
各 View::Create で WM_SHOWWINDOW(TRUE) が出ているか
OnInitialUpdate 中に WM_PAINT / WM_ERASEBKGND が出ているか
最後の UpdateWindow で大量 WM_PAINT が出ているか
個人的に一番怪しい箇所

この2行です。

m_pMainWnd->ShowWindow(SW_HIDE);
...
m_pMainWnd->ShowWindow(SW_SHOW);

ここで、別プロセスのウィンドウが、

自アプリが隠れる
  ↓
背後の別アプリがアクティブになる
  ↓
自アプリが再表示される
  ↓
別アプリが非アクティブになる

という状態遷移を受けます。

別プロセス側から見ると、自分のタイトルバー、フォーカス、入力状態、DWM 合成状態が短時間に変わります。
そのため「自アプリは隠しているのに、別プロセスがちらつく」という見え方になります。

推奨する最終形

最終的には、構成をこうするのが一番安定です。

仕様ファイル読み込み
  ↓
画面定義リスト作成
  ↓
MainFrame を WS_VISIBLE なしで作成
  ↓
最初に必要な View だけ WS_VISIBLE なしで作成
  ↓
View 内の多数コントロールも WS_VISIBLE なしで作成
  ↓
初期化完了
  ↓
最初の View だけ表示
  ↓
MainFrame を初めて ShowWindow(SW_SHOW)
  ↓
他 View は画面切替時に遅延 Create

つまり、起動時のループは本来こうしたいです。

for (auto p : specStatus)
{
    if (!p->m_bEnable)
        continue;

    RegisterViewSpec(p);   // まだ Create しない
}

CreateViewIfNeeded(initialViewIndex);
ShowOnlyView(initialViewIndex);

m_pMainWnd->ShowWindow(SW_SHOW);
// UpdateWindow はまず呼ばない

今回の現象だけを見るなら、全 View 事前 Create をやめて遅延生成が一番強い対策です。
事前生成が必要な場合でも、SW_HIDE で隠す方式ではなく、WS_VISIBLE を最初から使わない方式に寄せるべきです。

子コントロールも WS_VISIBLEなし　の場合、いつ子コントロールはVISIBLEになりますか？
思考時間: 10s

WS_VISIBLE なしで作った子コントロールは、自動では VISIBLE になりません。
明示的に次のどちらかを実行した時点で、WS_VISIBLE 状態になります。

pCtrl->ShowWindow(SW_SHOW);

または、

pCtrl->SetWindowPos(
    NULL, 0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
    SWP_NOACTIVATE | SWP_SHOWWINDOW
);

ただし、今回の目的なら、子コントロールを表示状態にするタイミングは、親 View / MainFrame を画面表示する前がよいです。

推奨タイミング

理想はこの順番です。

// MainFrame はまだ画面に出ていない
// View もまだ画面に出ていない

pView->CreateHidden();        // View: WS_VISIBLEなし

pView->CreateControlsHidden(); // 子コントロール: WS_VISIBLEなし
pView->InitializeControls();   // SetFont, SetWindowText, 初期値設定
pView->LayoutControls();       // MoveWindow / SetWindowPos

// ここで子コントロールを VISIBLE 状態にする
// ただし親 View / MainFrame がまだ非表示なので、画面には出ない
pView->ShowInitialControls();

// 最初に見せる View だけ VISIBLE にする
pView->ShowWindow(SW_SHOW);

// 最後に MainFrame を表示
m_pMainWnd->ShowWindow(SW_SHOW);

つまり、子コントロールの WS_VISIBLE は MainFrame を表示する直前に立てるのがよいです。

なぜ親が非表示のうちに ShowWindow(SW_SHOW) してよいのか

Win32 の子ウィンドウは、自分自身が WS_VISIBLE でも、親が非表示なら画面には出ません。

状態としてはこうです。

MainFrame: 非表示
  View: 非表示
    Button: WS_VISIBLEあり
    Edit:   WS_VISIBLEあり
    Combo:  WS_VISIBLEあり

この場合、子コントロールは内部的には「表示予定」状態ですが、親が非表示なので実画面には描画されません。

その後、親を表示すると、

MainFrame: 表示
  View: 表示
    Button: 表示
    Edit:   表示
    Combo:  表示

として、まとめて画面に出ます。

なので、親が非表示の間に子コントロールを ShowWindow(SW_SHOW) しておくのがポイントです。

逆に避けたい順番

これは避けたいです。

m_pMainWnd->ShowWindow(SW_SHOW);
pView->ShowWindow(SW_SHOW);

for (auto ctrl : controls)
{
    ctrl->ShowWindow(SW_SHOW);
}

この順番だと、MainFrame / View がすでに見えている状態で、子コントロールが1個ずつ表示されます。

親が表示済み
  ↓
子コントロールが1個ずつ ShowWindow
  ↓
そのたびに再描画
  ↓
ちらつき

になります。

実装例

View 側に、表示対象コントロールをまとめて表示する関数を作るのが扱いやすいです。

void CmyView::ShowInitialControls()
{
    for (CWnd* pCtrl : m_controls)
    {
        if (pCtrl && ::IsWindow(pCtrl->GetSafeHwnd()))
        {
            pCtrl->ShowWindow(SW_SHOW);
        }
    }
}

初期化側はこうです。

CmyView* pView = new CmyView(this, p->m_i2Kind);
m_viewPtr.push_back(pView);

pView->CreateHidden();          // View は WS_VISIBLEなし
pView->SendMessage(WM_SETREDRAW, FALSE);

pView->CreateControlsHidden();  // 子コントロールも WS_VISIBLEなし
pView->InitializeBySpec(p);
pView->LayoutControls();

pView->ShowInitialControls();   // 子コントロールを VISIBLE 状態にする
                                // ただし View/MainFrame が非表示なら画面には出ない

pView->SendMessage(WM_SETREDRAW, TRUE);

// View 自体はまだ非表示のまま
pView->ShowWindow(SW_HIDE);

最後に初期表示する View だけ出します。

CmyView* pInitialView = m_viewPtr[initialIndex];

pInitialView->ShowWindow(SW_SHOW);
SetActiveView(pInitialView);

m_pMainWnd->ShowWindow(SW_SHOW);

// まずは UpdateWindow は呼ばずに比較
// m_pMainWnd->UpdateWindow();
さらに安全な一括表示

子コントロール数が非常に多い場合は、ShowWindow を個別に大量実行するより、SetWindowPos に SWP_NOREDRAW を付けて、最後にまとめて再描画する方法もあります。

void CmyView::ShowInitialControlsNoRedraw()
{
    for (CWnd* pCtrl : m_controls)
    {
        if (!pCtrl || !::IsWindow(pCtrl->GetSafeHwnd()))
            continue;

        pCtrl->SetWindowPos(
            NULL,
            0, 0, 0, 0,
            SWP_NOMOVE |
            SWP_NOSIZE |
            SWP_NOZORDER |
            SWP_NOACTIVATE |
            SWP_NOREDRAW |
            SWP_SHOWWINDOW
        );
    }
}

親 View / MainFrame がまだ非表示なら、通常はここまでしなくても十分ですが、ちらつき・再描画ログが多い場合は試す価値があります。

結論

WS_VISIBLE なしで作った子コントロールは、自動では表示されません。

表示状態にするタイミングは、

子コントロールの生成・初期値設定・レイアウト完了後
かつ
MainFrame / View を画面に出す前

が最適です。

つまり今回なら、こうです。

pView->CreateControlsHidden();
pView->InitializeBySpec(p);
pView->LayoutControls();

pView->ShowInitialControls();   // ここで子コントロールを VISIBLE にする

// まだ画面には出ない
// 最後に View と MainFrame を表示

これにより、子コントロールは「表示準備済み」になりますが、親がまだ非表示なので、画面には一切出ません。最終的に MainFrame を表示した瞬間に、完成済みの画面として出せます。

スプラッシュを出すなら、重い MainFrame/View とは完全に分離した「軽量な別トップレベル窓」にするのが安全です。隠した MainFrame の子や所有ポップアップにすると、親の非表示状態に巻き込まれやすいです。

思考時間: 23s

できます。
この場合の基本方針は、重い MainFrame / View 初期化とは別に、2コントロールだけの軽量なトップレベル Splash Window を先に出すことです。

重要なのは、スプラッシュを MainFrame の子ウィンドウにしない ことです。

推奨構成
SplashWindow      ← 表示する。軽い。2コントロールだけ。
MainFrame         ← まだ表示しない。WS_VISIBLEなし。
  CmyView群       ← 非表示でCreate。
    子コントロール ← 非表示または親非表示中に初期化。

つまり、こういう関係にします。

Desktop
 ├─ SplashWindow  表示中
 └─ MainFrame     非表示
      └─ View     非表示

逆に、これは避けます。

MainFrame 非表示
 └─ SplashWindow

親が非表示だと、子や所有ポップアップも表示制御に巻き込まれます。

起動シーケンス例

概念的にはこうです。

BOOL CMyApp::InitInstance()
{
    CWinApp::InitInstance();

    // 1. 軽量スプラッシュを先に作る
    CSplashWnd splash;
    splash.CreateSplash(NULL);          // MainFrameの子にしない
    splash.ShowWindow(SW_SHOWNOACTIVATE);
    splash.UpdateWindow();              // スプラッシュだけ即描画

    // 2. MainFrameを作るが、まだ表示しない
    CMainFrame* pFrame = new CMainFrame;

    DWORD style = WS_OVERLAPPEDWINDOW | FWS_ADDTOTITLE;
    // WS_VISIBLE は入れない

    if (!pFrame->LoadFrame(IDR_MAINFRAME, style, NULL, NULL))
        return FALSE;

    m_pMainWnd = pFrame;

    // 3. 重いView群を非表示で作成
    splash.SetMessage(_T("画面を初期化しています..."));

    pFrame->BuildViewsHidden(&splash);

    // 4. 最初に表示するViewだけ準備
    pFrame->ShowInitialViewHiddenReady();

    // 5. スプラッシュを閉じる
    splash.DestroyWindow();

    // 6. 最後にMainFrameを初めて表示
    pFrame->ShowWindow(m_nCmdShow);
    pFrame->UpdateWindow();

    return TRUE;
}

ポイントは、ここです。

splash.ShowWindow(SW_SHOWNOACTIVATE);
splash.UpdateWindow();

スプラッシュだけは表示したいので、ここでは UpdateWindow() を使って構いません。
ただし、MainFrame 側にはまだ ShowWindow しないのが重要です。

SplashWindow の作り方

一番簡単なのは、モードレスダイアログ風の CDialogEx です。

class CSplashDlg : public CDialogEx
{
public:
    CSplashDlg() : CDialogEx(IDD_SPLASH) {}

    void SetMessage(LPCTSTR text)
    {
        SetDlgItemText(IDC_STATIC_MESSAGE, text);

        CWnd* pCtrl = GetDlgItem(IDC_STATIC_MESSAGE);
        if (pCtrl)
            pCtrl->UpdateWindow();

        UpdateWindow();
    }
};

作成側はこうです。

CSplashDlg splash;
splash.Create(IDD_SPLASH, NULL);     // 親NULL
splash.ShowWindow(SW_SHOWNOACTIVATE);
splash.UpdateWindow();

IDD_SPLASH には、たとえば以下の2つだけ置きます。

IDC_STATIC_MESSAGE
IDC_PROGRESS_INIT

これなら非常に軽いです。

MainFrame 初期化側

今の構成を活かすなら、次のような形にします。

void CMainFrame::BuildViewsHidden(CSplashDlg* pSplash)
{
    SendMessage(WM_SETREDRAW, FALSE);

    int index = 0;

    for (auto p : specStatus)
    {
        if (!p->m_bEnable)
            continue;

        if (pSplash)
        {
            CString msg;
            msg.Format(_T("画面 %d を初期化しています..."), index + 1);
            pSplash->SetMessage(msg);
        }

        CmyView* pView = new CmyView(this, p->m_i2Kind);
        m_viewPtr.push_back(pView);

        pView->CreateHidden(this);          // Viewは WS_VISIBLEなし
        pView->SendMessage(WM_SETREDRAW, FALSE);

        pView->InitializeBySpec(p);         // ここで子コントロール作成・初期値設定

        pView->ShowInitialControls();       // 親が非表示なので画面には出ない

        pView->SendMessage(WM_SETREDRAW, TRUE);
        pView->ShowWindow(SW_HIDE);

        ++index;
    }

    SendMessage(WM_SETREDRAW, TRUE);
}

View 側の CreateHidden は、必ず WS_VISIBLE を外します。

BOOL CmyView::CreateHidden(CWnd* pParent)
{
    DWORD style =
        WS_CHILD |
        WS_CLIPCHILDREN |
        WS_CLIPSIBLINGS;

    // WS_VISIBLE は付けない

    CRect rc(0, 0, 0, 0);

    return Create(
        NULL,
        NULL,
        style,
        rc,
        pParent,
        AFX_IDW_PANE_FIRST + m_i2Kind,
        NULL
    );
}
Splash の更新頻度は絞る

スプラッシュのメッセージを毎コントロールごとに更新すると、それ自体がちらつき・遅延の原因になります。

避けたい例です。

for (int i = 0; i < 1000; ++i)
{
    CreateControl(i);
    splash.SetMessage(...);   // 毎回更新は重い
}

おすすめは、View単位、画面種類単位、または100件ごとくらいです。

if ((count % 100) == 0)
{
    splash.SetMessage(...);
}

または時間で間引きます。

DWORD now = GetTickCount();

if (now - lastUpdate >= 100)
{
    splash.SetMessage(...);
    lastUpdate = now;
}
UIスレッドを長時間ブロックする場合の注意

初期化処理を UI スレッドで長時間実行すると、スプラッシュは最初の1回は表示できますが、途中のアニメーションや細かい更新は止まりやすいです。

最低限これは入れます。

splash.ShowWindow(SW_SHOWNOACTIVATE);
splash.UpdateWindow();

これで、重い処理に入る前にスプラッシュの初回描画は完了します。

途中経過を見せたい場合は、SetMessage() の中でスプラッシュだけ UpdateWindow() します。

void CSplashDlg::SetMessage(LPCTSTR text)
{
    SetDlgItemText(IDC_STATIC_MESSAGE, text);

    GetDlgItem(IDC_STATIC_MESSAGE)->UpdateWindow();
    UpdateWindow();
}

ただし、ここでアプリ全体のメッセージポンプを回す、

while (PeekMessage(...)) { ... }

のような処理は慎重にした方がよいです。
初期化中にユーザー操作や別メッセージが再入して、状態不整合を起こすことがあります。

可能なら「非UI初期化」と「UI生成」を分ける

仕様設定ファイルの読み込み・解析・画面定義の作成だけなら、これは UI を触らない処理です。

仕様ファイル読み込み
仕様解析
画面定義リスト作成

これはスプラッシュ表示後に処理してもよいですし、場合によってはワーカースレッド化できます。

一方で、これは UI スレッドで行うべきです。

CWnd::Create
子コントロール作成
SetWindowText
SetFont
MoveWindow

Win32/MFC のウィンドウ操作は、基本的に作成した UI スレッドで扱うのが安全です。

なので理想はこうです。

Splash表示
  ↓
仕様ファイル読み込み・解析
  ↓
MainFrameを非表示Create
  ↓
必要最小限のViewだけUIスレッドでCreate
  ↓
MainFrame表示
  ↓
残りViewは画面切替時に遅延Create
SW_HIDE は使わない

スプラッシュを出す場合でも、MainFrame に対してこれは避けます。

m_pMainWnd->ShowWindow(SW_HIDE);

代わりに、

MainFrameを最初から WS_VISIBLE なしで作る

です。

つまり、こうではなく、

m_pMainWnd->ShowWindow(SW_HIDE);
初期化;
m_pMainWnd->ShowWindow(SW_SHOW);

こうです。

MainFrameを非表示状態でCreate;
初期化;
m_pMainWnd->ShowWindow(SW_SHOW);

スプラッシュは MainFrame とは独立して表示します。

最終的な流れ

今回の要件なら、これが一番安定です。

1. SplashWindowを親NULLでCreate
2. SplashWindowをSW_SHOWNOACTIVATEで表示
3. SplashWindowだけUpdateWindow
4. MainFrameをWS_VISIBLEなしでCreate
5. 仕様ファイルから有効画面リストを作成
6. 必要なViewをWS_VISIBLEなしでCreate
7. 子コントロールも初期化中はWS_VISIBLEなし
8. 親がまだ非表示のうちに子コントロールをShowWindow(SW_SHOW)
9. 初期表示ViewだけShowWindow(SW_SHOW)
10. SplashWindowをDestroyWindow
11. MainFrameをShowWindow(SW_SHOW)
12. 必要なら最後にMainFrameだけUpdateWindow

実務的には、こういうイメージです。

CSplashDlg splash;
splash.Create(IDD_SPLASH, NULL);
splash.ShowWindow(SW_SHOWNOACTIVATE);
splash.UpdateWindow();

CreateMainFrameHidden();

splash.SetMessage(_T("仕様ファイルを読み込んでいます..."));
LoadSpecFile();

splash.SetMessage(_T("画面を生成しています..."));
BuildViewsHidden(&splash);

splash.SetMessage(_T("起動しています..."));
ShowInitialViewOnly();

splash.DestroyWindow();

m_pMainWnd->ShowWindow(SW_SHOW);
m_pMainWnd->UpdateWindow();

この方式なら、初期化中に見えるのは2コントロールだけのスプラッシュだけです。
大量コントロールを持つ View は、完成するまで一切画面に出ません。