// 8비트 사운드: 효과음은 Web Audio로 직접 합성, BGM은 파일(있으면) 또는 내장 칩튠 루프
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor({ bpm = 100, bgmSrc = null } = {}) {
    this.bpm = bpm;
    this.bgmSrc = bgmSrc;
    this.ctx = null;
    this.bgmOn = true;
    this.sfxOn = true;
    this._seqTimer = null;
    this._bgmSource = null;
    this._lastHover = 0;
  }

  // 사용자 클릭 이후에만 호출 (브라우저 자동재생 정책)
  async init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.35;
    this.bgmGain.connect(this.master);

    // 펄스파(듀티 25%, 12.5%) — 패미컴 느낌
    this.pulse25 = this._pulseWave(0.25);
    this.pulse12 = this._pulseWave(0.125);

    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    if (this.bgmSrc) {
      try {
        const res = await fetch(this.bgmSrc);
        this.bgmBuffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn("BGM 파일을 불러오지 못해 내장 칩튠을 사용합니다", e);
        this.bgmBuffer = null;
      }
    }
  }

  _pulseWave(duty) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  _tone({ freq, freqEnd, t = 0, dur = 0.08, vol = 0.3, wave = "square", dest }) {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + t;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (wave === "p25") o.setPeriodicWave(this.pulse25);
    else if (wave === "p12") o.setPeriodicWave(this.pulse12);
    else o.type = wave;
    o.frequency.setValueAtTime(freq, at);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
    g.gain.setValueAtTime(vol, at);
    g.gain.setValueAtTime(vol, at + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest || this.sfxGain);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  _noise({ t = 0, dur = 0.05, vol = 0.2, hp = 3000, dest }) {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + t;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(dest || this.sfxGain);
    s.start(at);
    s.stop(at + dur + 0.02);
  }

  play(name) {
    if (!this.ctx || !this.sfxOn) return;
    const T = (o) => this._tone(o);
    switch (name) {
      case "tab":
        T({ freq: 1180, dur: 0.035, vol: 0.18 });
        break;
      case "hover": {
        const now = performance.now();
        if (now - this._lastHover < 60) return;
        this._lastHover = now;
        T({ freq: 2200, dur: 0.015, vol: 0.05, wave: "p12" });
        break;
      }
      case "equip":
        T({ freq: NOTE(84), dur: 0.06, vol: 0.22, wave: "p25" });
        T({ freq: NOTE(91), t: 0.06, dur: 0.1, vol: 0.22, wave: "p25" });
        break;
      case "unequip":
        T({ freq: 520, freqEnd: 260, dur: 0.09, vol: 0.22 });
        break;
      case "up":
        T({ freq: NOTE(79), dur: 0.04, vol: 0.18, wave: "p25" });
        T({ freq: NOTE(84), t: 0.04, dur: 0.04, vol: 0.18, wave: "p25" });
        break;
      case "down":
        T({ freq: NOTE(79), dur: 0.04, vol: 0.18, wave: "p25" });
        T({ freq: NOTE(74), t: 0.04, dur: 0.04, vol: 0.18, wave: "p25" });
        break;
      case "color":
        T({ freq: 600, freqEnd: 1300, dur: 0.08, vol: 0.14, wave: "p12" });
        break;
      case "select":
        T({ freq: NOTE(88), dur: 0.05, vol: 0.18, wave: "p25" });
        break;
      case "random": {
        for (let i = 0; i < 9; i++) {
          T({ freq: NOTE(72 + ((i * 5) % 12)), t: i * 0.045, dur: 0.04, vol: 0.15, wave: "p25" });
        }
        T({ freq: NOTE(84), t: 0.43, dur: 0.08, vol: 0.22, wave: "p25" });
        T({ freq: NOTE(91), t: 0.51, dur: 0.22, vol: 0.22, wave: "p25" });
        break;
      }
      case "shutter":
        this._noise({ dur: 0.05, vol: 0.35, hp: 2500 });
        this._noise({ t: 0.07, dur: 0.08, vol: 0.25, hp: 1500 });
        T({ freq: NOTE(96), t: 0.02, dur: 0.05, vol: 0.12, wave: "p12" });
        break;
      case "start":
        [72, 76, 79, 84].forEach((m, i) =>
          T({ freq: NOTE(m), t: i * 0.09, dur: i === 3 ? 0.25 : 0.08, vol: 0.22, wave: "p25" })
        );
        break;
      case "error":
        T({ freq: 200, dur: 0.12, vol: 0.18 });
        break;
    }
  }

  // ------------------------------------------------------------ BGM
  setBgm(on) {
    this.bgmOn = on;
    if (on) this.startBgm();
    else this.stopBgm();
  }

  startBgm() {
    if (!this.ctx || !this.bgmOn) return;
    this.stopBgm();
    if (this.bgmBuffer) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.bgmBuffer;
      s.loop = true;
      s.connect(this.bgmGain);
      s.start();
      this._bgmSource = s;
      return;
    }
    this._startSequencer();
  }

  stopBgm() {
    if (this._bgmSource) {
      try { this._bgmSource.stop(); } catch (e) { /* 이미 정지 */ }
      this._bgmSource = null;
    }
    if (this._seqTimer) {
      clearInterval(this._seqTimer);
      this._seqTimer = null;
    }
  }

  // 내장 칩튠 (C - Am - F - G 루프). 진짜 BGM 파일이 오면 options.json의 audio.bgm에 경로만 넣으면 교체됨.
  _startSequencer() {
    const eighth = 60 / this.bpm / 2;
    const chords = [
      [48, [60, 64, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [59, 62, 67]],
      [48, [60, 64, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [59, 62, 67]],
    ];
    // 0 = 쉼표
    const melody = [
      76, 0, 79, 0, 76, 74, 72, 0,
      72, 0, 76, 0, 81, 0, 79, 0,
      77, 0, 81, 0, 79, 77, 76, 0,
      74, 0, 0, 0, 67, 0, 71, 74,
      76, 0, 79, 0, 84, 0, 83, 0,
      81, 0, 79, 76, 0, 0, 72, 74,
      76, 0, 77, 0, 81, 0, 79, 77,
      74, 0, 76, 74, 72, 0, 0, 0,
    ];
    const total = melody.length;
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    const dest = this.bgmGain;
    const tick = () => {
      while (next < this.ctx.currentTime + 0.25) {
        const t = next - this.ctx.currentTime;
        const bar = Math.floor(step / 8) % chords.length;
        const [root, tones] = chords[bar];
        const s8 = step % 8;
        // 베이스 (삼각파)
        const bassPat = [0, null, 12, null, 7, null, 12, 7];
        if (bassPat[s8] !== null) {
          this._tone({ freq: NOTE(root + bassPat[s8]), t, dur: eighth * 0.9, vol: 0.32, wave: "triangle", dest });
        }
        // 아르페지오 (12.5% 펄스, 작게)
        this._tone({ freq: NOTE(tones[s8 % 3] + 12), t, dur: eighth * 0.5, vol: 0.05, wave: "p12", dest });
        // 멜로디
        const m = melody[step % total];
        if (m) this._tone({ freq: NOTE(m), t, dur: eighth * 0.85, vol: 0.13, wave: "p25", dest });
        // 하이햇
        if (s8 % 2 === 1) this._noise({ t, dur: 0.03, vol: 0.06, hp: 7000, dest });
        step++;
        next += eighth;
      }
    };
    tick();
    this._seqTimer = setInterval(tick, 60);
  }
}
