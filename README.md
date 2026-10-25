# taxi｜長者安心乘車・GitHub Pages 展示版

從原先的 PHP 長者乘客端改寫而成的 **純 HTML / CSS / JavaScript 操作展示**，可以直接部署在 GitHub Pages。

## 展示功能

- **首頁**：大型「我要去醫院」「我要回家」按鈕，下一次回診及最近的用車規劃。
- **回診**：新增、修改、刪除回診的日期／時間／院所／地址／備註。
- **用車**：輸入上下車地點與日期時間，儲存規劃、查看及取消。
- **設定**：記住常用住家地址、字體可在「一般／大／特大／超大」四種尺寸間選擇，且會記住選擇。
- **長者友善**：大按鈕、高對比、繁體中文、手機單欄與固定底部導覽。

這是作品展示，**不會實際派車**。沒有會員登入、PHP API、MySQL、付款、GPS 或醫療資訊串接；請不要輸入真實的姓名、住址或病歷資訊。

## 直接開啟

下載後解壓縮，雙擊 `index.html` 就能使用。可在桌機瀏覽器或手機 GitHub Pages 連結操作。

## 部署到 GitHub Pages

1. 在 GitHub 建立新的 Repository，例如 `yoxi-care-senior-demo`。
2. 將 **`index.html`、`assets/` 資料夾、`README.md` 和 `.nojekyll`** 上傳到 Repository 的根目錄（不要只上傳 ZIP）。
3. 進入 Repository → **Settings → Pages**。
4. 在 **Build and deployment** 的 Source 選 **Deploy from a branch**。
5. Branch 選 `main`，資料夾選 `/(root)`，按 **Save**。
6. 部署完成後，網站網址通常是 `https://你的帳號.github.io/yoxi-care-senior-demo/`。

如果 Repository 名稱與示例不同，網址最後一段也會不同；請以 GitHub Pages 顯示的實際網址為準。

## 專案結構

```text
yoxi-care-github-pages/
├── index.html             網站入口（取代 index.php）
├── assets/
│   ├── style.css          長者版響應式樣式
│   └── app.js             畫面、表單、驗證與本機資料儲存
├── .nojekyll              關閉不需要的 Jekyll 處理
└── README.md              安裝與展示說明
```

## 資料怎麼保存？

此展示版使用瀏覽器 `localStorage`。新增回診或儲存用車規劃後，**同一瀏覽器重新整理通常仍會保留資料**。切換不同裝置／瀏覽器、使用無痕模式或清除網站資料，紀錄可能消失。資料不會同步到 GitHub，也不會提交到任何伺服器。

原版 PHP 的 `config.php`、`db.php`、`functions.php`、`state_process.php` 與 `services/` 不再需要。需要正式後端時，可另保留 PHP 原始版作為開發分支。

## 展示前建議

1. 在「設定」輸入**假的示範地址**。
2. 在「回診」新增一筆**假的回診**，時間填未來日期。
3. 回首頁點選「我要去醫院」，填好搭車時間與地址。
4. 到「紀錄」確認規劃可查詢、取消。

這些資料只是瀏覽器本機儲存的展示內容，不代表車隊已收到需求。

## 字體調整更新

從右上角「字體：一般」或「設定 → 文字大小」可選擇 **一般、大、特大、超大**。字體大小會儲存在同一瀏覽器中；字體變更提示僅顯示 1.2 秒，其他操作提示約 2.6 秒，不會遮擋點擊。舊版展示資料會保留。
