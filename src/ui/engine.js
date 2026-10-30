/*
 * MtnAI ui — analysis engine bridge.
 * Builds a Web Worker from the core factories' own source text (Blob URL), so it
 * also works when index.html is opened straight from disk (file://). Falls back
 * to running the jobs on the main thread if workers are unavailable.
 */
(function (UI) {
  'use strict';

  const M = (UI.M = {});
  for (const f of globalThis.MTN_CORE) f(M);

  /** Worker entry point (serialised; must not reference outer scope). */
  function workerMain(M) {
    const session = M.createSession();
    self.onmessage = async (ev) => {
      const { id, cmd, args } = ev.data;
      const progress = (p, msg) => self.postMessage({ id, type: 'progress', p, msg });
      try {
        const fn = session.jobs[cmd];
        if (!fn) throw new Error('Unknown job: ' + cmd);
        const result = await fn(args || {}, progress);
        self.postMessage({ id, type: 'result', result }, M.transferables(result));
      } catch (e) {
        self.postMessage({ id, type: 'error', error: String((e && e.message) || e) });
      }
    };
    self.postMessage({ type: 'ready' });
  }

  class Engine {
    constructor() {
      this.pending = new Map();
      this.nextId = 1;
      this.ready = false;
      this.mode = 'worker';
      try {
        const src = '"use strict";\nconst M = {};\n' +
          globalThis.MTN_CORE.map((f) => '(' + f.toString() + ')(M);').join('\n') +
          '\n(' + workerMain.toString() + ')(M);';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        this.worker.onmessage = (ev) => this._onMsg(ev.data);
        this.worker.onerror = (e) => {
          if (!this.ready) { e.preventDefault && e.preventDefault(); this._fallback(); }
        };
      } catch (e) {
        this._fallback();
      }
    }

    _fallback() {
      if (this.mode === 'local') return;
      console.warn('MtnAI: Web Worker unavailable, running analysis on the main thread.');
      this.mode = 'local';
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.local = M.createSession();
      const replay = [...this.pending.values()];
      this.pending.clear();
      for (const p of replay) this._runLocal(p.cmd, p.args, p.onProgress).then(p.resolve, p.reject);
    }

    _onMsg(d) {
      if (d.type === 'ready') { this.ready = true; return; }
      const p = this.pending.get(d.id);
      if (!p) return;
      if (d.type === 'progress') { p.onProgress && p.onProgress(d.p, d.msg); return; }
      this.pending.delete(d.id);
      if (d.type === 'result') p.resolve(d.result); else p.reject(new Error(d.error));
    }

    _runLocal(cmd, args, onProgress) {
      return new Promise((resolve, reject) => setTimeout(async () => {
        try { resolve(await this.local.jobs[cmd](args || {}, (p, m) => onProgress && onProgress(p, m))); }
        catch (e) { reject(e); }
      }, 20));
    }

    /** Run a job; resolves with its result. onProgress(p 0..1, message). */
    call(cmd, args, onProgress) {
      if (this.mode === 'local') return this._runLocal(cmd, args, onProgress);
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onProgress, cmd, args });
        this.worker.postMessage({ id, cmd, args });
      });
    }
  }

  UI.Engine = Engine;
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
