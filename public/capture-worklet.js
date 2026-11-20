// Captures microphone samples with the exact audio-clock frame they belong to.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.on = true;
      if (e.data === 'stop') { this.on = false; this.port.postMessage({ type: 'stopped' }); }
    };
  }
  process(inputs) {
    const inp = inputs[0];
    if (this.on && inp && inp[0]) {
      this.port.postMessage({ type: 'data', frame: currentFrame, data: inp[0].slice(0) });
    }
    return true;
  }
}
registerProcessor('capture', Capture);
