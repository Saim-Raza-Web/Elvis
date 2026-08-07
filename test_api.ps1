$baseUrl = "http://localhost:5000/api/v1"

function OrElse($a, $b) { if ($null -ne $a -and $a -ne '') { $a } else { $b } }

# --- LOGIN ---
Write-Host ""
Write-Host "=== STEP 1: LOGIN ===" -ForegroundColor Cyan
$body = '{"email":"admin@demologistics.io","password":"admin123"}'
try {
    $loginResp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -ContentType "application/json" -Body $body
    $token = $loginResp.token
    $userName = OrElse $loginResp.user.name "unknown"
    $userRole = OrElse $loginResp.user.role "unknown"
    Write-Host "OK LOGIN SUCCESS - User: $userName | Role: $userRole" -ForegroundColor Green
} catch {
    Write-Host "FAIL LOGIN FAILED: $_" -ForegroundColor Red
    exit 1
}
$headers = @{ Authorization = "Bearer $token" }

# --- ASN LIST ---
Write-Host ""
Write-Host "=== STEP 2: ASN LIST ===" -ForegroundColor Cyan
$asnId = $null
try {
    $asns = Invoke-RestMethod -Uri "$baseUrl/asn" -Headers $headers
    $asnData = if ($asns.data) { $asns.data } elseif ($asns -is [array]) { $asns } else { @($asns) }
    Write-Host "OK ASN COUNT: $($asnData.Count)" -ForegroundColor Green
    if ($asnData.Count -gt 0) {
        $firstASN = $asnData[0]
        $asnId = $firstASN._id
        $asnStatus = OrElse $firstASN.status "?"
        $itemCount = if ($firstASN.items) { $firstASN.items.Count } else { 0 }
        Write-Host "   First ASN: $asnId | Status: $asnStatus | Items: $itemCount"
    }
} catch {
    Write-Host "FAIL ASN LIST: $($_.Exception.Message)" -ForegroundColor Red
}

# --- PROPOSE LOCATION ---
Write-Host ""
Write-Host "=== STEP 3: DYNAMIC LOCATION PROPOSALS ===" -ForegroundColor Cyan
$skus = @("SKU-001", "SKU-COLD-001", "SKU-HAZ-001")
foreach ($sku in $skus) {
    try {
        $propBody = '{"sku":"' + $sku + '","warehouseId":"default"}'
        $prop = Invoke-RestMethod -Uri "$baseUrl/putaway/propose-location" -Method POST -ContentType "application/json" -Headers $headers -Body $propBody
        $bin = OrElse $prop.proposedBin (OrElse $prop.bin (OrElse $prop.location ($prop | ConvertTo-Json -Compress)))
        $flag = if ($bin -eq "BIN-01") { "HARDCODED-STILL" } else { "DYNAMIC-OK" }
        $color = if ($bin -eq "BIN-01") { "Red" } else { "Green" }
        Write-Host "   $sku -> $bin  [$flag]" -ForegroundColor $color
    } catch {
        Write-Host "   FAIL $sku -> $($_.Exception.Message)" -ForegroundColor Red
    }
}

# --- RECEIVING ---
Write-Host ""
Write-Host "=== STEP 4: RECEIVING API ===" -ForegroundColor Cyan
if ($asnId) {
    try {
        $recBody = '{"asnId":"' + $asnId + '","sku":"SKU-001","qty":1,"condition":"good"}'
        $rec = Invoke-RestMethod -Uri "$baseUrl/receiving" -Method POST -ContentType "application/json" -Headers $headers -Body $recBody
        Write-Host "OK RECEIVING POST SUCCESS" -ForegroundColor Green
        Write-Host ("   " + ($rec | ConvertTo-Json -Compress -Depth 3))
    } catch {
        Write-Host "FAIL RECEIVING: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "   SKIP - no ASN ID available" -ForegroundColor Yellow
}

# --- DOCUMENTS ---
Write-Host ""
Write-Host "=== STEP 5: DOCUMENTS ===" -ForegroundColor Cyan
try {
    $docs = Invoke-RestMethod -Uri "$baseUrl/documents" -Headers $headers
    $docData = if ($docs.data) { $docs.data } elseif ($docs -is [array]) { $docs } else { @($docs) }
    Write-Host "OK DOCUMENTS: $($docData.Count) records" -ForegroundColor Green
    $docData | Select-Object -First 5 | ForEach-Object {
        $type = OrElse $_.type (OrElse $_.documentType "unknown")
        $status = OrElse $_.status ""
        $ref = OrElse $_.reference (OrElse $_.asnNumber "")
        Write-Host "   Type: $type | Status: $status | Ref: $ref"
    }
} catch {
    Write-Host "FAIL DOCUMENTS: $($_.Exception.Message)" -ForegroundColor Red
}

# --- DISCREPANCIES ---
Write-Host ""
Write-Host "=== STEP 6: DISCREPANCIES ===" -ForegroundColor Cyan
try {
    $disc = Invoke-RestMethod -Uri "$baseUrl/discrepancies" -Headers $headers
    $discData = if ($disc.data) { $disc.data } elseif ($disc -is [array]) { $disc } else { @($disc) }
    Write-Host "OK DISCREPANCIES: $($discData.Count) records" -ForegroundColor Green
    $discData | Select-Object -First 5 | ForEach-Object {
        $reason = OrElse $_.reason (OrElse $_.type "N/A")
        $sku = OrElse $_.sku (OrElse $_.item "")
        Write-Host "   Reason: $reason | SKU: $sku"
    }
} catch {
    Write-Host "FAIL DISCREPANCIES: $($_.Exception.Message)" -ForegroundColor Red
}

# --- INCIDENTS ---
Write-Host ""
Write-Host "=== STEP 7: INCIDENTS ===" -ForegroundColor Cyan
try {
    $inc = Invoke-RestMethod -Uri "$baseUrl/incidents" -Headers $headers
    $incData = if ($inc.data) { $inc.data } elseif ($inc -is [array]) { $inc } else { @($inc) }
    Write-Host "OK INCIDENTS: $($incData.Count) records" -ForegroundColor Green
    $incData | Select-Object -First 5 | ForEach-Object {
        $title = OrElse $_.title (OrElse $_.type "N/A")
        $sev = OrElse $_.severity ""
        Write-Host "   Title: $title | Severity: $sev"
    }
} catch {
    Write-Host "FAIL INCIDENTS: $($_.Exception.Message)" -ForegroundColor Red
}

# --- ACTIVITY LOG ---
Write-Host ""
Write-Host "=== STEP 8: ACTIVITY LOG ===" -ForegroundColor Cyan
try {
    $act = Invoke-RestMethod -Uri "$baseUrl/activity" -Headers $headers
    $actData = if ($act.data) { $act.data } elseif ($act -is [array]) { $act } else { @($act) }
    Write-Host "OK ACTIVITY LOG: $($actData.Count) records" -ForegroundColor Green
    $actData | Select-Object -First 5 | ForEach-Object {
        $action = OrElse $_.action (OrElse $_.type "N/A")
        $ts = OrElse $_.createdAt ""
        Write-Host "   Action: $action | At: $ts"
    }
} catch {
    Write-Host "FAIL ACTIVITY LOG: $($_.Exception.Message)" -ForegroundColor Red
}

# --- NOTIFICATIONS ---
Write-Host ""
Write-Host "=== STEP 9: NOTIFICATIONS ===" -ForegroundColor Cyan
try {
    $notif = Invoke-RestMethod -Uri "$baseUrl/notifications" -Headers $headers
    $notifData = if ($notif.data) { $notif.data } elseif ($notif -is [array]) { $notif } else { @($notif) }
    Write-Host "OK NOTIFICATIONS: $($notifData.Count) records" -ForegroundColor Green
    $notifData | Select-Object -First 5 | ForEach-Object {
        $msg = OrElse $_.message (OrElse $_.title "N/A")
        Write-Host "   Msg: $msg"
    }
} catch {
    Write-Host "FAIL NOTIFICATIONS: $($_.Exception.Message)" -ForegroundColor Red
}

# --- PUTAWAY QUEUE ---
Write-Host ""
Write-Host "=== STEP 10: PUTAWAY QUEUE ===" -ForegroundColor Cyan
try {
    $putaway = Invoke-RestMethod -Uri "$baseUrl/putaway" -Headers $headers
    $putData = if ($putaway.data) { $putaway.data } elseif ($putaway -is [array]) { $putaway } else { @($putaway) }
    Write-Host "OK PUTAWAY ITEMS: $($putData.Count)" -ForegroundColor Green
    $putData | Select-Object -First 5 | ForEach-Object {
        $sku = OrElse $_.sku ""
        $bin = OrElse $_.proposedBin (OrElse $_.destination "N/A")
        $status = OrElse $_.status "N/A"
        Write-Host "   SKU: $sku | Bin: $bin | Status: $status"
    }
} catch {
    Write-Host "FAIL PUTAWAY: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== API VERIFICATION COMPLETE ===" -ForegroundColor Cyan
