# Kedi Lo-Fi Pomodoro — Masaüstüne .exe oluşturma scripti
Write-Host "🐾 Kedi Lo-Fi Pomodoro derleniyor..." -ForegroundColor Magenta

# 1. Bağımlılıkları kontrol et
if (-not (Test-Path "node_modules\electron-builder")) {
  Write-Host "📦 electron-builder kuruluyor..." -ForegroundColor Cyan
  npm install electron-builder --save-dev
}

# 2. Derle
Write-Host "🔨 Derleme başlıyor..." -ForegroundColor Cyan
npm run dist

# 3. Masaüstüne kopyala
$desktop = [Environment]::GetFolderPath("Desktop")
$source = "dist\KediLoFiPomodoro.exe"
$target = Join-Path $desktop "Kedi Lo-Fi Pomodoro.exe"

if (Test-Path $source) {
  Copy-Item $source $target -Force
  Write-Host ""
  Write-Host "✅ BAŞARILI!" -ForegroundColor Green
  Write-Host "📁 Masaüstüne kaydedildi: $target" -ForegroundColor Green
  Write-Host ""
  Write-Host "🐾 Çift tıklayarak açabilirsin." -ForegroundColor Yellow
} else {
  Write-Host "❌ Hata: dist\KediLoFiPomodoro.exe bulunamadı!" -ForegroundColor Red
  Write-Host "   dist klasörünü kontrol et." -ForegroundColor Red
}