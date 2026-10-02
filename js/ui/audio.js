// 声音层 · 真静音（suspend AudioContext）而不是把 gain 设 0
//
// 为什么这条要写死：把 master gain 设 0 是**假静音** —— 振荡器照建、AudioContext 照 running、
// CPU 照花，只是听不见；任何"静音态还在新建节点"的实现都会在 stats 上露出来。
// 本文件的口径：muted 为真时 play() 在**建节点之前**就返回（stats.blocked 涨、oscCreated 不涨），
// 并且对已有的 AudioContext 调 suspend()；取消静音才 resume()。
//
// 没有音频文件：三个音都是现合成的短包（本仓零二进制音频资产，包络与频率都写在这里）。
// 首次手势之前不建 AudioContext —— 浏览器的自动播放策略下，早建的 ctx 只会以 suspended 状态挂着。

const VOICES = {
  mark: { type: 'triangle', f0: 392, f1: 300, dur: 0.075, gain: 0.16 },
  erase: { type: 'sine', f0: 240, f1: 180, dur: 0.06, gain: 0.11 },
  invalid: { type: 'square', f0: 110, f1: 82, dur: 0.13, gain: 0.09 },
  win: { type: 'triangle', f0: 523, f1: 784, dur: 0.34, gain: 0.14 },
};

export function makeAudio(ACtor = typeof AudioContext !== 'undefined' ? AudioContext : null) {
  let ctx = null;
  let muted = false;
  const stats = {
    oscCreated: 0, plays: 0, blocked: 0, suspends: 0, resumes: 0,
    get state() { return ctx ? ctx.state : 'no-context'; },
  };

  function ensure() {
    if (ctx) return ctx;
    if (!ACtor) return null;                       // 环境没有 WebAudio：静音之外没别的事可做
    ctx = new ACtor();
    return ctx;
  }

  /** 播放一个短包。静音态**不新建任何节点**（这条是判据的本体，不是实现细节）。 */
  function play(kind = 'mark') {
    const v = VOICES[kind] || VOICES.mark;
    if (muted) { stats.blocked++; return false; }
    const c = ensure();
    if (!c) return false;
    if (c.state === 'suspended') { c.resume(); stats.resumes++; }
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1), t + v.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + v.dur + 0.02);
    stats.oscCreated++;
    stats.plays++;
    return true;
  }

  /** 首次用户手势里调一下：把 ctx 从 suspended 抬起来（自动播放策略要求手势上下文）。 */
  function unlock() {
    const c = ensure();
    if (!c || c.state !== 'suspended') return false;
    c.resume();
    stats.resumes++;
    return true;
  }

  /** 静音开关：真停 AudioContext。取消静音只 resume，不重建。 */
  function setMuted(on) {
    muted = !!on;
    if (!ctx) return muted;
    if (muted) {
      if (ctx.state === 'running') { ctx.suspend(); stats.suspends++; }
    } else if (ctx.state === 'suspended') {
      ctx.resume(); stats.resumes++;
    }
    return muted;
  }

  return {
    play, unlock, stats: () => ({ ...stats }),
    muted: () => muted,
    setMuted,
    voices: () => Object.keys(VOICES),
  };
}
