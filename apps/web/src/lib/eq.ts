import { EQ_FREQS, type EqConfig, isFlat, preGainDb } from './eqPresets.ts';

/**
 * The equaliser: ten peaking filters (shelves at the two ends), a bass low shelf, a pre-gain that makes room for the boosts and a
 * gentle limiter as the backstop. Web Audio on the player's <audio> element. Browsers allow `createMediaElementSource` once per
 * element, after which all its sound goes through the graph, so the graph is built the first time a curve is asked for and is
 * bypassed (flat, no limiting) when the equaliser is off or the curve is flat. In the Android app the same curve is handed to the
 * app's own player (lib/nativeAudio.ts), because the page does not play the sound there.
 */
export const EQ_SHELF_HZ = 110;
const Q = 1.1;

interface Graph { ctx: AudioContext; bands: BiquadFilterNode[]; low: BiquadFilterNode; pre: GainNode; limiter: DynamicsCompressorNode }
let graph: Graph | null = null;
/** every <audio> element the player owns (there are two while crossfading); each feeds the same chain once the graph exists */
const elements = new Set<HTMLAudioElement>();
const routed = new Set<HTMLAudioElement>();
function route(el: HTMLAudioElement) {
  if (!graph || routed.has(el)) return;
  routed.add(el); // createMediaElementSource works once per element
  graph.ctx.createMediaElementSource(el).connect(graph.bands[0]);
}
/** Tell the equaliser about another player element so its sound goes through the same chain. */
export function addEqElement(el: HTMLAudioElement) { elements.add(el); route(el); }

/**
 * Route another element (a Rank preview, the Spotify stream) through the same equaliser, so the volume of previews matches what you set
 * for playback (bass boost especially: a preview that skipped it was far louder). Call before the element's `src` is set. Does nothing
 * while the equaliser is off and was never turned on.
 */
export function eqAttach(el: HTMLAudioElement, cfg: EqConfig) {
  if (isFlat(cfg) && !graph) return;
  el.crossOrigin = 'anonymous'; // the graph reads the sound: the server answers with CORS headers
  addEqElement(el);
  if (!graph) setEq(el, cfg);
  el.addEventListener('play', resumeEq);
}

export function setEq(el: HTMLAudioElement, cfg: EqConfig) {
  const flat = isFlat(cfg);
  if (!graph) {
    if (flat || typeof AudioContext === 'undefined') return; // never touch the sound until it is wanted
    const ctx = new AudioContext();
    const bands = EQ_FREQS.map((hz, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = hz; f.Q.value = Q;
      return f;
    });
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = EQ_SHELF_HZ;
    const pre = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.knee.value = 4; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    let node: AudioNode = bands[0];
    for (const f of [...bands.slice(1), low, pre, limiter]) { node.connect(f); node = f; }
    limiter.connect(ctx.destination);
    graph = { ctx, bands, low, pre, limiter };
    elements.add(el);
    for (const e of elements) route(e);
  }
  const g = graph;
  const t = g.ctx.currentTime;
  g.bands.forEach((f, i) => f.gain.setTargetAtTime(flat ? 0 : cfg.bands[i] ?? 0, t, 0.03));
  g.low.gain.setTargetAtTime(flat ? 0 : Math.max(0, cfg.bass), t, 0.03);
  g.pre.gain.setTargetAtTime(flat ? 1 : Math.pow(10, preGainDb(cfg) / 20), t, 0.03);
  g.limiter.threshold.value = flat ? 0 : -2; g.limiter.ratio.value = flat ? 1 : 12;
  if (g.ctx.state === 'suspended') void g.ctx.resume();
}

/** Call from a play event: a context created before the first user gesture starts suspended. */
export function resumeEq() { if (graph?.ctx.state === 'suspended') void graph.ctx.resume(); }
