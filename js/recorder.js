// 무대(방) 구역만 녹화: 캔버스 영상 + 게임 소리 → mp4(가능하면) / webm
const TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export class Recorder {
  constructor({ width, height }) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.active = false;
    this.startedAt = 0;
  }

  static supported() {
    return typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
  }

  get mime() {
    return TYPES.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  }

  // 매 프레임 무대 캔버스를 녹화용 캔버스로 복사 (정수배 확대)
  draw(stage) {
    if (!this.active) return;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(stage, 0, 0, this.canvas.width, this.canvas.height);
  }

  start(audioDest) {
    const stream = this.canvas.captureStream(60);
    if (audioDest) audioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    this.chunks = [];
    const mimeType = this.mime;
    this.rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });
    this.rec.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.active = true;
    this.startedAt = performance.now();
  }

  stop() {
    return new Promise((res) => {
      if (!this.rec) return res(null);
      this.rec.onstop = () => {
        const type = this.rec.mimeType || this.mime || "video/webm";
        const blob = new Blob(this.chunks, { type: type.split(";")[0] });
        this.active = false;
        res({ blob, ext: type.includes("mp4") ? "mp4" : "webm" });
      };
      this.rec.stop();
    });
  }

  elapsed() {
    return this.active ? performance.now() - this.startedAt : 0;
  }
}
