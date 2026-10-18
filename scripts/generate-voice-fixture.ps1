$ErrorActionPreference = 'Stop'
$voiceProjectRoot = Split-Path -Parent $PSScriptRoot
$voiceFixtureDirectory = Join-Path $voiceProjectRoot '.local'
New-Item -ItemType Directory -Force -Path $voiceFixtureDirectory | Out-Null
Add-Type -AssemblyName System.Speech
$voiceSynthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voiceFixtureFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList 16000,([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen),([System.Speech.AudioFormat.AudioChannel]::Mono)
    $voiceSynthesizer.SetOutputToWaveFile((Join-Path $voiceFixtureDirectory 'voice-fixture-source.wav'), $voiceFixtureFormat)
    $voiceSynthesizer.Speak('How many approvals are pending?')
} finally {
    $voiceSynthesizer.Dispose()
}
Write-Output 'Synthetic speech fixture created. No microphone was used.'
