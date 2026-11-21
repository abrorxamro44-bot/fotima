class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const ratio = sampleRate / this.targetSampleRate;

    let sumSquares = 0;
    for (let i = 0; i < channelData.length; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    const rms = Math.min(1, Math.sqrt(sumSquares / channelData.length) * 3.5);
    this.port.postMessage({ type: 'rms', value: rms });

    if (ratio <= 1) {
      for (let i = 0; i < channelData.length; i++) {
        this.buffer.push(channelData[i]);
      }
    } else {
      for (let i = 0; i < channelData.length; i += ratio) {
        const idx = Math.floor(i);
        if (idx < channelData.length) {
          this.buffer.push(channelData[idx]);
        }
      }
    }

    const chunkSize = 1600;
    while (this.buffer.length >= chunkSize) {
      const slice = this.buffer.splice(0, chunkSize);
      const pcm16 = new Int16Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        const s = Math.max(-1, Math.min(1, slice[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ type: 'pcm', buffer: pcm16.buffer }, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);