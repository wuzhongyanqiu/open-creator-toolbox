// Playwright init script: tee every WebAudio graph that reaches the speakers
// into a MediaRecorder, so headless gameplay captures can keep game audio.
// Playwright's recordVideo never records sound; without this, store videos
// end up with a silent AAC track.
//
//   await context.addInitScript({ path: 'webaudio-tap.js' });
//   ... play ...
//   const { base64, startedAt, mimeType } = await page.evaluate(() => window.__promoAudio.stop());
//
// startedAt is performance.now() in ms when the first AudioContext appeared;
// use it as the adelay offset when muxing with the page video.
// Covers AudioContext/Phaser/Howler(WebAudio mode). Plain <audio> elements are
// routed through the tap on play() when possible.
(() => {
  if (window.__promoAudio) return;
  const taps = new Map();
  const chunks = [];
  let recorder = null;
  let startedAt = null;
  let mix = null;
  let mixDestination = null;

  const ensureMix = () => {
    if (mix) return;
    mix = new AudioContext();
    mixDestination = mix.createMediaStreamDestination();
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    recorder = new MediaRecorder(mixDestination.stream, { mimeType });
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.start(250);
    startedAt = performance.now();
  };

  const tapFor = (context) => {
    if (taps.has(context)) return taps.get(context);
    ensureMix();
    const streamDestination = context.createMediaStreamDestination();
    const source = mix.createMediaStreamSource(streamDestination.stream);
    source.connect(mixDestination);
    taps.set(context, streamDestination);
    if (mix.state === 'suspended') mix.resume();
    return streamDestination;
  };

  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function connect(target, ...rest) {
    const result = originalConnect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode && this.context !== mix) {
      originalConnect.call(this, tapFor(this.context));
    }
    return result;
  };

  const originalPlay = HTMLMediaElement.prototype.play;
  const routed = new WeakSet();
  HTMLMediaElement.prototype.play = function play(...args) {
    try {
      if (!routed.has(this)) {
        ensureMix();
        const source = mix.createMediaElementSource(this);
        source.connect(mix.destination);
        source.connect(mixDestination);
        routed.add(this);
      }
    } catch { /* cross-origin or already-routed elements play untapped */ }
    return originalPlay.apply(this, args);
  };

  window.__promoAudio = {
    get startedAt() { return startedAt; },
    stop: () => new Promise((resolve) => {
      if (!recorder) return resolve({ base64: null, startedAt: null, mimeType: null });
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        resolve({ base64: btoa(binary), startedAt, mimeType: recorder.mimeType });
      };
      recorder.stop();
    }),
  };
})();
