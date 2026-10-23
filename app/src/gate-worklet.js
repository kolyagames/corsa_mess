// Шумовой порог для микрофона. Пока звук тише порога, микрофон закрыт: не слышно клавиатуры и фона.
// Открывается почти сразу (начало слова не теряется), закрывается плавно и не раньше чем через 250 мс тишины.
class CorsaGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: -100, minValue: -100, maxValue: 0, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.gain = 1;
    this.hold = 0;
    this.blocks = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    let sum = 0;
    let n = 0;
    for (const ch of input) { for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]; n += ch.length; }
    const db = 10 * Math.log10(sum / Math.max(1, n) + 1e-12);
    const thr = params.threshold[0];
    const loud = thr <= -99 || db > thr;
    this.hold = loud ? sampleRate * 0.25 : Math.max(0, this.hold - input[0].length);
    const target = loud || this.hold > 0 ? 1 : 0;
    let g = this.gain;
    for (let c = 0; c < output.length; c++) {
      const src = input[Math.min(c, input.length - 1)];
      const out = output[c];
      g = this.gain;
      for (let i = 0; i < out.length; i++) {
        g += (target - g) * (target > g ? 0.02 : 0.0015);
        out[i] = src[i] * g;
      }
    }
    this.gain = g;
    // Уровень для полоски в настройках: примерно 40 раз в секунду.
    if (++this.blocks % 8 === 0) this.port.postMessage({ db, open: target === 1 });
    return true;
  }
}

registerProcessor('corsa-gate', CorsaGate);
