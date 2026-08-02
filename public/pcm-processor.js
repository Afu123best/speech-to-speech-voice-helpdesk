class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];

    if (input.length > 0) {
      const channelData = input[0];
      const pcmData = new Int16Array(channelData.length);

      for (let i = 0; i < channelData.length; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        pcmData[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }

      this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);