Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot "..\public\icons"
if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null
}

function Create-Dusk-Icon([int]$sz, [string]$outName) {
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Transparent canvas
    $g.Clear([System.Drawing.Color]::Transparent)

    # 1. Rounded rectangle squircle background
    $radius = $sz * 0.24
    $rect = New-Object System.Drawing.RectangleF(0, 0, $sz, $sz)
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $bgPath.AddArc(0, 0, $d, $d, 180, 90)
    $bgPath.AddArc($sz - $d, 0, $d, $d, 270, 90)
    $bgPath.AddArc($sz - $d, $sz - $d, $d, $d, 0, 90)
    $bgPath.AddArc(0, $sz - $d, $d, $d, 90, 90)
    $bgPath.CloseFigure()

    # Midnight gradient matching Dusk artwork (#232152 -> #141334)
    $cTop = [System.Drawing.Color]::FromArgb(255, 38, 34, 86)     # #262256
    $cBottom = [System.Drawing.Color]::FromArgb(255, 20, 19, 52)  # #141334
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $cTop, $cBottom, 45.0)
    $g.FillPath($bgBrush, $bgPath)

    # Subtle inner border for contrast
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(40, 255, 255, 255), [float]($sz * 0.02))
    $g.DrawPath($borderPen, $bgPath)

    # 2. Glowing Crescent Moon
    # Outer circle of crescent
    $outerR = $sz * 0.27
    $outerX = $sz * 0.44
    $outerY = $sz * 0.52

    $outerPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $outerPath.AddEllipse([float]($outerX - $outerR), [float]($outerY - $outerR), [float]($outerR * 2), [float]($outerR * 2))

    # Inner subtract circle
    $innerR = $sz * 0.23
    $innerX = $sz * 0.53
    $innerY = $sz * 0.44

    $innerPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $innerPath.AddEllipse([float]($innerX - $innerR), [float]($innerY - $innerR), [float]($innerR * 2), [float]($innerR * 2))

    $moonRegion = New-Object System.Drawing.Region($outerPath)
    $moonRegion.Exclude($innerPath)

    # Soft ethereal moon color (#e3e6fc)
    $moonColor = [System.Drawing.Color]::FromArgb(255, 227, 230, 252)
    $moonBrush = New-Object System.Drawing.SolidBrush($moonColor)
    $g.FillRegion($moonBrush, $moonRegion)

    # 3. Warm amber star dot (#f6b856)
    $starR = $sz * 0.046
    $starX = $sz * 0.69
    $starY = $sz * 0.29

    # Star glow
    $starGlowR = $starR * 1.8
    $starGlowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 246, 184, 86))
    $g.FillEllipse($starGlowBrush, [float]($starX - $starGlowR), [float]($starY - $starGlowR), [float]($starGlowR * 2), [float]($starGlowR * 2))

    # Star core
    $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 246, 184, 86))
    $g.FillEllipse($starBrush, [float]($starX - $starR), [float]($starY - $starR), [float]($starR * 2), [float]($starR * 2))

    $target = Join-Path $iconsDir $outName
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

    # Also copy 192 as app/favicon.ico and public/favicon.ico if small
    if ($sz -eq 192) {
        $pubFav = Join-Path $PSScriptRoot "..\public\favicon.ico"
        $appFav = Join-Path $PSScriptRoot "..\app\favicon.ico"
        $bmp.Save($pubFav, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Save($appFav, [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Saved Dusk icon: $target"
}

Create-Dusk-Icon 192 "icon-192.png"
Create-Dusk-Icon 512 "icon-512.png"
