import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './predeployment-config.mjs';

export async function checkVoiceBrowser({ protocol, navigate, screenshot, setVoiceHandler }) {
  const report = { timestamp: new Date().toISOString(), passed: false, checks: {}, note: 'Synthetic Chromium microphone. Audio transcription responses are fixtures to make browser checks deterministic; the agent answer uses the real isolated API. Live free Whisper recognition is verified separately in voice-provider.json. No physical microphone or customer audio is used.' };
  const uploads = []; let failNext = false; let delayNext = 0; let stage = 'initialization';
  const clickText = async text => protocol.evaluate(`Array.from(document.querySelectorAll('.wf-voice-panel button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);
  const start = async () => {
    await protocol.evaluate('document.querySelector(".wf-voice-trigger").click()');
    await protocol.wait('document.querySelector(".wf-voice-panel")?.textContent.includes("Recording…")');
    if (process.argv.includes('--companion-browser')) { await protocol.wait('document.querySelector(".wf-companion")?.dataset.state==="listening"'); report.checks.companionListeningState = true; }
    await protocol.evaluate('new Promise(resolve=>setTimeout(resolve,1100))');
  };
  const stop = async () => { await clickText('Stop recording'); await protocol.wait('!!document.querySelector(".wf-voice-panel audio")'); };
  const setDraft = async value => protocol.evaluate(`(()=>{const input=document.querySelector('#workforce-question');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  try {
    setVoiceHandler(async event => {
      const request = event.params;
      const headers = Object.fromEntries(Object.entries(request.request.headers).map(([key, value]) => [key.toLowerCase(), value]));
      uploads.push({ id: headers['x-voice-request-id'], contentType: headers['content-type'] });
      const failing = failNext; failNext = false;
      const delay = delayNext; delayNext = 0;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await protocol.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: failing ? 502 : 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(failing ? { success: false, error: { message: 'Voice upload could not be confirmed. Retry the same recording or type your question.' } } : { success: true, data: { transcript: 'How many approvals are pending?', question: 'How many approvals are pending?' } })).toString('base64'),
      }, event.sessionId);
    });
    await protocol.send('Fetch.enable', { patterns: [{ urlPattern: '*onboarding-status*' }, { urlPattern: '*/api/auth/me' }, { urlPattern: '*/api/voice/transcribe*' }] });
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
    await navigate('/dashboard'); await protocol.wait('!!document.querySelector(".wf-voice-trigger")');
    // Track only the fake streams, to verify microphone release.
    await protocol.evaluate('(()=>{window.__voiceStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__voiceStreams.push(stream);return stream}})()');
    stage = 'record preview and draft preservation';
    await setDraft('Existing draft:'); await start(); await stop();
    assert.equal(uploads.length, 0, 'Preview must not upload audio');
    assert.equal(await protocol.evaluate('window.__voiceStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'), true);
    assert.ok(await protocol.evaluate('document.querySelector(".wf-voice-panel audio").src.startsWith("blob:")'));
    await protocol.evaluate('document.querySelector(".wf-composer").scrollIntoView({block:"center"})');
    await screenshot('voice-recording-preview');
    report.checks.recordPreviewWithoutUpload = true; report.checks.stopReleasesMicrophone = true;
    stage = 'transcription and actual agent answer';
    await clickText('Use recording'); await protocol.wait('document.querySelector("#workforce-question")?.value.includes("How many approvals are pending?")');
    assert.equal(await protocol.evaluate('document.querySelector("#workforce-question").value'), 'Existing draft:\nHow many approvals are pending?');
    assert.equal(await protocol.evaluate('document.querySelectorAll(".wf-exchange").length'), 0, 'A question must not send before review');
    assert.equal(uploads[0].contentType, 'audio/wav'); assert.match(uploads[0].id, /^[\da-f-]{36}$/i);
    report.checks.editableTranscriptPreservesTypedDraft = true;
    await protocol.evaluate('document.querySelector(".wf-composer button[type=submit]").click()');
    await protocol.wait('!!document.querySelector(".wf-answer > p")');
    if (process.argv.includes('--companion-browser')) { await protocol.wait('document.querySelector(".wf-companion")?.dataset.state==="answered"'); report.checks.companionAnswerState = true; }
    assert.match(await protocol.evaluate('document.querySelector(".wf-answer > p").textContent'), /pending/i);
    report.checks.voiceQuestionGetsRealAgentAnswer = true;
    stage = 'cancel recording';
    await setDraft('Keep my draft'); await start();
    await protocol.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await protocol.wait('!document.querySelector(".wf-voice-panel") && document.activeElement?.matches(".wf-voice-trigger")');
    assert.equal(await protocol.evaluate('document.querySelector("#workforce-question").value'), 'Keep my draft');
    assert.equal(await protocol.evaluate('window.__voiceStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'), true);
    report.checks.cancelPreservesDraftAndStopsTracks = true;
    report.checks.keyboardEscapeRestoresMicrophoneFocus = true;
    stage = 'background microphone release';
    await start();
    await protocol.evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));delete document.hidden');
    await protocol.wait('!!document.querySelector(".wf-voice-panel audio")');
    assert.equal(await protocol.evaluate('window.__voiceStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'), true);
    await protocol.evaluate('document.querySelector(".wf-voice-heading button").click()');
    report.checks.hiddenPageStopsMicrophone = true;
    stage = 'retry request identity';
    await start(); await stop(); failNext = true; await clickText('Use recording');
    await protocol.wait('document.querySelector(".wf-voice-panel [role=alert]")?.textContent.includes("could not be confirmed")');
    const failedId = uploads.at(-1).id;
    await clickText('Use recording'); await protocol.wait('!document.querySelector(".wf-voice-panel")');
    assert.equal(uploads.at(-1).id, failedId);
    report.checks.uncertainRetryUsesSameRecordingIdentity = true;
    stage = 'typing during transcription';
    await setDraft('Before upload:'); await start(); await stop(); delayNext = 2000;
    await clickText('Use recording');
    await protocol.wait('document.querySelector(".wf-voice-panel")?.textContent.includes("Transcribing your recording")');
    if (process.argv.includes('--companion-browser')) { await protocol.wait('document.querySelector(".wf-companion")?.dataset.state==="thinking"'); report.checks.companionProcessingState = true; }
    await setDraft('Edited while uploading:');
    await protocol.wait('!document.querySelector(".wf-voice-panel")');
    assert.equal(await protocol.evaluate('document.querySelector("#workforce-question").value'), 'Edited while uploading:\nHow many approvals are pending?');
    report.checks.typingDuringTranscriptionIsPreserved = true;
    stage = 'permission rejection';
    await protocol.evaluate('navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException("Denied","NotAllowedError")}');
    await protocol.evaluate('document.querySelector(".wf-voice-trigger").click()');
    await protocol.wait('document.querySelector(".wf-voice-panel [role=alert]")?.textContent.includes("access was denied")');
    if (process.argv.includes('--companion-browser')) { await protocol.wait('document.querySelector(".wf-companion")?.dataset.state==="error"'); report.checks.companionErrorState = true; }
    assert.equal(await protocol.evaluate('document.querySelector(".wf-composer button[type=submit]").disabled'), false);
    report.checks.permissionDeniedKeepsTypedChatAvailable = true;
    await protocol.evaluate('document.querySelector(".wf-voice-heading button").click()');
    stage = 'Arabic mobile layout';
    await protocol.evaluate('(()=>{const select=document.querySelector(".wf-language-control select");select.value="ar";select.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await protocol.wait('document.documentElement.lang==="ar"');
    await protocol.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 850, deviceScaleFactor: 1, mobile: true });
    await navigate('/dashboard'); await protocol.wait('!!document.querySelector(".wf-voice-trigger")');
    await protocol.evaluate('document.querySelector(".wf-voice-trigger").click()');
    await protocol.wait('!!document.querySelector(".wf-voice-timer")');
    await protocol.evaluate('new Promise(resolve=>setTimeout(resolve,1100))');
    await protocol.evaluate('document.querySelector(".wf-voice-actions button").click()');
    await protocol.wait('!!document.querySelector(".wf-voice-panel audio")');
    assert.equal(await protocol.evaluate('document.documentElement.scrollWidth>innerWidth+2'), false);
    await protocol.evaluate('document.querySelector(".wf-composer").scrollIntoView({block:"center"})');
    await screenshot('voice-arabic-mobile');
    await protocol.evaluate('document.querySelector(".wf-voice-heading button").click()');
    report.checks.arabicMobileControlsFit = true;
    report.passed = true;
  } catch (error) {
    report.error = { stage, message: error.code === 'ERR_ASSERTION' || error.message?.startsWith('Browser') ? error.message : 'Voice browser check failed; internal response details suppressed.' };
  } finally { fs.writeFileSync(path.join(root, 'artifacts/voice-browser.json'), JSON.stringify(report, null, 2)); }
  assert.ok(report.passed, `Voice browser verification failed at ${stage}`);
  return report;
}
