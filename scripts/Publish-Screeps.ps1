[CmdletBinding()]
param (
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]
    $Path,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]
    $Branch,
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]
    $User = $env:SCREEPS_USER,
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]
    $Token = $env:SCREEPS_TOKEN
)

$ErrorActionPreference = "Stop"

$ResolvedPath = (Resolve-Path $Path).Path
Write-Host "Publishing $ResolvedPath to $User/$Branch"
$Content = Get-Content $ResolvedPath -Raw
Write-Host "Content length: $($Content.Length) chars"

$base64Auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(("{0}:{1}" -f $User, $Token)))
Write-Verbose "Use Basic Auth: $base64Auth"
# $Credential = [pscredential]::new($User, ( ConvertTo-SecureString $Token -AsPlainText -Force))

$Body = @{
    branch  = $Branch;
    modules = @{
        main = [string]$Content;
    }
}

$Body | ConvertTo-Json -Compress | Invoke-RestMethod https://screeps.com/api/user/code -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Headers @{
        "X-Token" = $Token;
    }
