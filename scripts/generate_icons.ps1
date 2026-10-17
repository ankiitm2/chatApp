Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot "..\public\icons"
if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null
}

function Create-Icon([int]$sz, [string]$outName) {
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Dark rounded background with slight border
    $rect = New-Object System.Drawing.Rectangle(0, 0, $sz, $sz)
    $cTop = [System.Drawing.Color]::FromArgb(255, 13, 16, 23)     # #0d1017
    $cBottom = [System.Drawing.Color]::FromArgb(255, 91, 77, 242)  # #5b4df2
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $cTop, $cBottom, 45.0)
    $g.FillRectangle($brush, $rect)

    # Soft glowing central aura
    $center = $sz / 2.0
    $orbRadius = $sz * 0.32
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
    $g.FillEllipse($glowBrush, [float]($center - $orbRadius), [float]($center - $orbRadius), [float]($orbRadius * 2), [float]($orbRadius * 2))

    # Signal arcs
    $penWave = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 255, 255), [float]($sz * 0.055))
    $penWave.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penWave.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Outer signals
    $w1 = $sz * 0.54
    $g.DrawArc($penWave, [float]($center - $w1/2), [float]($center - $w1/2), [float]$w1, [float]$w1, -45.0, 90.0)
    $g.DrawArc($penWave, [float]($center - $w1/2), [float]($center - $w1/2), [float]$w1, [float]$w1, 135.0, 90.0)

    # Inner signals
    $w2 = $sz * 0.34
    $g.DrawArc($penWave, [float]($center - $w2/2), [float]($center - $w2/2), [float]$w2, [float]$w2, -45.0, 90.0)
    $g.DrawArc($penWave, [float]($center - $w2/2), [float]($center - $w2/2), [float]$w2, [float]$w2, 135.0, 90.0)

    # Center dot
    $coreRadius = $sz * 0.075
    $coreBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($coreBrush, [float]($center - $coreRadius), [float]($center - $coreRadius), [float]($coreRadius * 2), [float]($coreRadius * 2))

    $target = Join-Path $iconsDir $outName
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Saved: $target"
}

Create-Icon 192 "icon-192.png"
Create-Icon 512 "icon-512.png"
