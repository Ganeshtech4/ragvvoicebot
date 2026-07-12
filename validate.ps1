# DocuBot Platform Release Validation Script

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Starting DocuBot Release Validation Suite" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$allPassed = $true

# Helper function to run steps
function Run-Check($title, $command, $arguments) {
    Write-Host "`nChecking: $title..." -ForegroundColor Yellow
    $process = Start-Process -FilePath $command -ArgumentList $arguments -NoNewWindow -PassThru -Wait
    if ($process.ExitCode -eq 0) {
        Write-Host "  [PASS] $title" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $title (Exit Code: $($process.ExitCode))" -ForegroundColor Red
        global: $allPassed = $false
    }
}

# 1. Ruff Linter
Run-Check "Ruff Linter" "ruff" "check ."

# 2. Black Formatter Check
Run-Check "Black Formatter Check" "black" "--check ."

# 3. isort Imports Check
Run-Check "isort Import Order" "isort" "--check ."

# 4. mypy Type Check
Run-Check "mypy Type Checking" "mypy" "docubot-backend/app chatbot-rag/"

# 5. pytest Tests
Run-Check "pytest Test Suite" "pytest" "-v"

# 6. Bandit Security Scan
Run-Check "Bandit Security Scan" "bandit" "-r docubot-backend/app chatbot-rag/ -ll"

Write-Host "`n=========================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host " Release Validation successful! Ready to ship." -ForegroundColor Green
} else {
    Write-Host " Some validation steps failed. Please resolve errors." -ForegroundColor Red
}
Write-Host "=========================================" -ForegroundColor Cyan
