# Kedi ikonu oluşturucu - PNG + ICO üretir
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "assets"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

Write-Host "🐾 Kedi ikonu çiziliyor..." -ForegroundColor Magenta

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode = 'HighQuality'

# --- Arka plan: mor gradient daire ---
$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(210, 175, 255),
    [System.Drawing.Color]::FromArgb(90, 45, 140),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
)
$g.FillEllipse($gradBrush, 6, 6, $size - 12, $size - 12)

# --- Kulaklar (önce çizilsin, kafanın arkasında kalsın) ---
$earBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 205, 245))
# Sol kulak
$leftEar = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 68, 130),
    (New-Object System.Drawing.Point 78, 48),
    (New-Object System.Drawing.Point 122, 92)
)
$g.FillPolygon($earBrush, $leftEar)
# Sağ kulak
$rightEar = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 188, 130),
    (New-Object System.Drawing.Point 178, 48),
    (New-Object System.Drawing.Point 134, 92)
)
$g.FillPolygon($earBrush, $rightEar)

# İç kulaklar (pembe)
$innerEarBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 158, 181))
$leftInner = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 82, 118),
    (New-Object System.Drawing.Point 88, 65),
    (New-Object System.Drawing.Point 114, 92)
)
$g.FillPolygon($innerEarBrush, $leftInner)
$rightInner = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 174, 118),
    (New-Object System.Drawing.Point 168, 65),
    (New-Object System.Drawing.Point 142, 92)
)
$g.FillPolygon($innerEarBrush, $rightInner)

# --- Kafa: yumuşak beyaz oval ---
$headBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(232, 224, 250))
$g.FillEllipse($headBrush, 58, 82, 140, 135)

# Kafa kenarı (mor outline)
$headPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 162, 255), 3)
$g.DrawEllipse($headPen, 58, 82, 140, 135)

# --- Gözler ---
$eyeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(43, 27, 61))
$g.FillEllipse($eyeBrush, 98, 138, 16, 20)
$g.FillEllipse($eyeBrush, 142, 138, 16, 20)

# Göz parlamaları
$shBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillEllipse($shBrush, 102, 142, 6, 6)
$g.FillEllipse($shBrush, 146, 142, 6, 6)

# --- Burun: pembe üçgen ---
$noseBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 158, 181))
$nose = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 128, 175),
    (New-Object System.Drawing.Point 118, 184),
    (New-Object System.Drawing.Point 138, 184)
)
$g.FillPolygon($noseBrush, $nose)

# --- Ağız ---
$mouthPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(43, 27, 61), 3)
$mouthPen.StartCap = 'Round'
$mouthPen.EndCap = 'Round'
$g.DrawLine($mouthPen, 128, 184, 128, 192)
$g.DrawArc($mouthPen, 112, 185, 16, 14, 0, 180)
$g.DrawArc($mouthPen, 128, 185, 16, 14, 0, 180)

# --- Bıyıklar ---
$whiskerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(168, 144, 208), 2)
$whiskerPen.StartCap = 'Round'
$whiskerPen.EndCap = 'Round'
# Sol
$g.DrawLine($whiskerPen, 28, 160, 85, 168)
$g.DrawLine($whiskerPen, 28, 178, 85, 178)
$g.DrawLine($whiskerPen, 28, 196, 85, 188)
# Sağ
$g.DrawLine($whiskerPen, 171, 168, 228, 160)
$g.DrawLine($whiskerPen, 171, 178, 228, 178)
$g.DrawLine($whiskerPen, 171, 188, 228, 196)

# --- Yanaklar (hafif pembe) ---
$cheekBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 255, 158, 181))
$g.FillEllipse($cheekBrush, 72, 168, 30, 20)
$g.FillEllipse($cheekBrush, 154, 168, 30, 20)

# ============ KAYDET ============
$pngPath = Join-Path $outDir "kedu.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "✅ PNG kaydedildi: $pngPath" -ForegroundColor Green

# ICO oluştur
$hicon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$icoPath = Join-Path $outDir "kedu.ico"
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()

Write-Host "✅ ICO kaydedildi: $icoPath" -ForegroundColor Green
Write-Host ""
Write-Host "🐾 İkon hazır!" -ForegroundColor Magenta

# Temizlik
$icon.Dispose()
$bmp.Dispose()
$g.Dispose()
$gradBrush.Dispose()
$headBrush.Dispose()
$earBrush.Dispose()
$innerEarBrush.Dispose()
$eyeBrush.Dispose()
$shBrush.Dispose()
$noseBrush.Dispose()
$cheekBrush.Dispose()
$headPen.Dispose()
$mouthPen.Dispose()
$whiskerPen.Dispose()