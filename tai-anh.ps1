# tai-anh.ps1 — tải toàn bộ ảnh/icon từ Figma về thư mục images/
# Chạy trong terminal của VS Code, đứng ở thư mục web-ban-hang:
#   powershell -ExecutionPolicy Bypass -File .\tai-anh.ps1
# LƯU Ý: link Figma chỉ sống 7 ngày kể từ lúc tạo. Hết hạn thì nhờ Claude lấy link mới.

$base = "https://www.figma.com/api/mcp/asset/"

# "id-trên-figma" = "đường dẫn lưu trên máy"
$assets = [ordered]@{
  # --- Ảnh PNG ---
  "9d6103fa-7e85-4e89-b8e6-0521323a6a8b.png" = "images/products/hero-blade-16.png"
  "61195f7b-ed43-43b4-855f-4b0ee8188fd1.png" = "images/categories/laptop.png"
  "d64f0d8e-9379-4a6d-9a46-855e031e7730.png" = "images/categories/phone.png"
  "304d08ea-e5d7-488f-b92d-6dd74933f77c.png" = "images/categories/audio.png"
  "8b44221c-bf44-4e93-a837-6ee0832cd3b1.png" = "images/categories/accessory.png"
  "01610276-ec92-42b8-a41e-d400f0eb05a9.png" = "images/products/blade-16.png"
  "5cc1c63d-be81-449a-919c-183f4a4338b5.png" = "images/products/nova-pro.png"
  "c162f652-c9f9-4772-9111-166be68ecf9d.png" = "images/products/air-14.png"
  "af7adc37-c079-4e87-ab28-8cfa62de8a3d.png" = "images/products/pulse-buds.png"
  "dbf57af0-f5c1-4dc0-875a-414f200d899a.png" = "images/banners/nova-pro.png"
  "577123a9-5648-49cb-882c-469e942e8d1d.png" = "images/products/acc-pulse-buds.png"
  "56ba088e-8545-4d6f-85f2-bef76d14a600.png" = "images/products/acc-core-m75.png"
  "80fbb497-e2c2-44e3-9657-4a8a219a8232.png" = "images/products/acc-gan-100w.png"
  "2c0a4e41-90ce-4f97-9976-db84326f9682.png" = "images/articles/bai-1.png"
  "360b16d6-49c7-4036-8d21-018fdb7141a2.png" = "images/articles/bai-2.png"
  "de36346a-68e9-4a16-a658-a6873a623f84.png" = "images/articles/bai-3.png"

  # --- Nền hero (SVG) ---
  "31296d80-b14a-42fa-8ce3-bf285a81defd.svg" = "images/bg/glow.svg"
  "46c56b55-faca-4e24-8ce1-271e854ce3f5.svg" = "images/bg/orbit-outer.svg"
  "6a64d405-48f8-4473-a922-5367ccadf5fd.svg" = "images/bg/orbit-inner.svg"
  "c812fc79-068c-45ed-8104-b422b4568704.svg" = "images/bg/diagonal.svg"

  # --- Icon (SVG) ---
  "5496d19e-d264-459a-8a4a-d864d04a1c73.svg" = "images/icons/zap.svg"
  "820ef3d9-b2c8-4c23-b103-e77f2e87f03b.svg" = "images/icons/search.svg"
  "6adcc255-700c-4237-976b-19f5cfe34ed2.svg" = "images/icons/headphones.svg"
  "fe86a118-aa97-40d6-9846-7e4977228d8d.svg" = "images/icons/user-round.svg"
  "abf5a13f-ad41-4ee4-ac48-bef19842a6cd.svg" = "images/icons/shopping-bag.svg"
  "1195c28f-67a3-46d3-8c55-3b87fca1379c.svg" = "images/icons/shield-check.svg"
  "a4355a2b-ca23-4868-9fb7-568e111364c1.svg" = "images/icons/arrow-up-right.svg"
  "a5ab16d5-1461-4a0e-bafe-deb67691a65f.svg" = "images/icons/arrow-up-right-cat.svg"
  "08166e21-fb07-4850-932d-68f404624b83.svg" = "images/icons/arrow-left.svg"
  "5fd05b08-02be-4dbb-8780-fda98343575a.svg" = "images/icons/arrow-right.svg"
  "e834d9a7-bc97-4acb-a8d4-36baa11fa307.svg" = "images/icons/badge-check.svg"
  "ada358b0-685b-450a-9899-6145d8feee4b.svg" = "images/icons/truck.svg"
  "7742689a-ad23-4bf9-96e0-12c78f6a579d.svg" = "images/icons/refresh-cw.svg"
  "80818252-ee90-482d-a284-1d90d1683568.svg" = "images/icons/credit-card.svg"
  "3973aa17-578c-4f57-aa6c-833ddb411fc1.svg" = "images/icons/heart.svg"
  "914ff5c0-d224-4055-a98f-16ac16f5dc32.svg" = "images/icons/plus.svg"
  "eaa164c5-0631-4ec5-b47b-fdc9bf6d8978.svg" = "images/icons/gift.svg"
  "747a7938-1805-4460-af49-93e8b5a92dbf.svg" = "images/icons/messages-square.svg"
  "61085ff2-f4af-437c-be93-53241ecb64d2.svg" = "images/icons/wrench.svg"
  "482ad6fa-9d6d-46fb-b8c9-114c119b98d1.svg" = "images/icons/store.svg"
}

$ok = 0; $fail = 0
foreach ($id in $assets.Keys) {
  $dest = $assets[$id]
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  try {
    Invoke-WebRequest -Uri ($base + $id) -OutFile $dest -UseBasicParsing
    Write-Host "OK   $dest" -ForegroundColor Green
    $ok++
  } catch {
    Write-Host "LỖI  $dest  ($($_.Exception.Message))" -ForegroundColor Red
    $fail++
  }
}
Write-Host "`nXong: $ok thành công, $fail lỗi."
