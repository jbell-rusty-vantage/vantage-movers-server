param(
  [Parameter(Mandatory=$true)][string]$Target,
  [ValidateSet('report','apply','verify')][string]$Mode='report',
  [ValidateRange(1,500)][int]$PageSize=500,
  [ValidateRange(1,200)][int]$MaxPages=20,
  [string]$SmsAfter='', [string]$SubjectAfter=''
)
# Every invocation and page is bounded; returned cursors are safe restart checkpoints.
for ($page=0; $page -lt $MaxPages; $page++) {
  $taskArgs=@('--env-file=.env','--import','tsx','ops/sales-outreach/performance-backfill.ts',"--target=$Target","--limit=$PageSize")
  if ($Mode -ne 'report') { $taskArgs += "--$Mode" }
  if ($SmsAfter) { $taskArgs += "--sms-after=$SmsAfter" }
  if ($SubjectAfter) { $taskArgs += "--subject-after=$SubjectAfter" }
  $result=& node @taskArgs
  $taskExit=$LASTEXITCODE
  $result | Write-Output
  if ($taskExit -ne 0) { exit $taskExit }
  $summary=$result | Select-Object -Last 1 | ConvertFrom-Json
  if ($summary.sms_exhausted -and $summary.subjects_exhausted) { exit 0 }
  $SmsAfter=$summary.sms_after; $SubjectAfter=$summary.subject_after
}
Write-Output "Page budget reached. Resume with -SmsAfter $SmsAfter -SubjectAfter $SubjectAfter"
