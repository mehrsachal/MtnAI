/*
 * MtnAI ui — 3D terrain view in plain WebGL2 (no libraries).
 * Heightfield mesh (<= 512 x 512 vertices) with the analysis composite draped as
 * a mip-mapped texture, side skirts, sun lighting and distance haze. NATO symbols
 * are drawn as screen-space billboards with leader lines on an overlay canvas.
 * Orbit: left-drag · Pan: right-drag or Shift+drag · Zoom: wheel · Recentre: double-click
 */
(function (UI) {
  'use strict';

  // ---------------------------------------------------------------- tiny mat4 (column-major)
  const m4 = {
    persp(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(e, t, u) {
      let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
      let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
      l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
      return o;
    },
    inv(m) {
      const inv = new Float32Array(16);
      inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
      inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
      inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
      inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
      inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
      inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
      inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
      inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
      inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
      inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
      inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
      inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
      inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
      inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
      inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
      inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
      let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
      det = det ? 1 / det : 0;
      for (let i = 0; i < 16; i++) inv[i] *= det;
      return inv;
    },
    xf(m, v) {
      const x = v[0], y = v[1], z = v[2], w = v[3] ?? 1;
      return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
    },
  };

  const VS = `#version 300 es
  in vec3 aPos; in vec3 aNorm; in vec2 aUV;
  uniform mat4 uMVP; uniform float uVex; uniform float uZ0;
  out vec3 vN; out vec2 vUV; out vec3 vW;
  void main() {
    vec3 p = vec3(aPos.x, (aPos.y - uZ0) * uVex, aPos.z);
    vW = p; vN = aNorm; vUV = aUV;
    gl_Position = uMVP * vec4(p, 1.0);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vN; in vec2 vUV; in vec3 vW;
  uniform sampler2D uTex; uniform vec3 uSun; uniform float uSide; uniform vec3 uEye; uniform float uFog;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(vN);
    float l = max(dot(n, uSun), 0.0);
    vec3 base = uSide > 0.5 ? vec3(0.27, 0.23, 0.18) : texture(uTex, vUV).rgb;
    vec3 col = base * (0.72 + 0.42 * l);
    float d = length(vW - uEye);
    float f = clamp((d - uFog * 0.35) / (uFog * 1.6), 0.0, 0.55);
    col = mix(col, vec3(0.42, 0.47, 0.56), f);
    outColor = vec4(col, 1.0);
  }`;

  class View3D {
    constructor(glCanvas, ovlCanvas, app) {
      this.cv = glCanvas; this.ov = ovlCanvas; this.app = app;
      this.octx = ovlCanvas.getContext('2d');
      this.gl = glCanvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: true });
      this.ok = !!this.gl;
      this.vex = 1.5;
      this.cam = { yaw: 0.35, pitch: 0.55, dist: 10000, target: [0, 0, 0] };
      this._raf = 0;
      this.visible = false;
      if (!this.ok) return;
      this._initGL();
      this._bind();
      new ResizeObserver(() => this.resize()).observe(glCanvas);
    }

    _initGL() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNorm'); gl.bindAttribLocation(p, 2, 'aUV');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.prog = p;
      this.u = {};
      for (const n of ['uMVP', 'uVex', 'uZ0', 'uTex', 'uSun', 'uSide', 'uEye', 'uFog']) this.u[n] = gl.getUniformLocation(p, n);
      this.tex = gl.createTexture();
      this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      for (const c of [this.cv, this.ov]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
      this.render();
    }

    /** Build the terrain mesh from the app grid. */
    setTerrain(g, z) {
      if (!this.ok) return;
      this.g = g; this.z = z;
      const { min, max } = UI.M.minMax(z);
      this.zMin = min; this.zMax = max; this.z0 = (min + max) / 2;
      const step = Math.max(1, Math.ceil(Math.max(g.w, g.h) / 512));
      const cols = [], rows = [];
      for (let c = 0; c < g.w; c += step) cols.push(c);
      if (cols[cols.length - 1] !== g.w - 1) cols.push(g.w - 1);
      for (let r = 0; r < g.h; r += step) rows.push(r);
      if (rows[rows.length - 1] !== g.h - 1) rows.push(g.h - 1);
      this.cols = cols; this.rows = rows;
      const nx = cols.length, ny = rows.length;
      const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, c = cols[i], r = rows[j];
        pos[k * 3] = this.wx(c); pos[k * 3 + 1] = z[r * g.w + c]; pos[k * 3 + 2] = this.wz(r);
        uv[k * 2] = (c + 0.5) / g.w; uv[k * 2 + 1] = (r + 0.5) / g.h;
      }
      const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
      let q = 0;
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
      this.mesh = this._upload(this.mesh, pos, null, uv, idx);
      this.meshPos = pos; this.nx = nx; this.ny = ny;
      this._buildSkirt();
      this._normals();
      this.home();
    }

    wx(c) { return (c - (this.g.w - 1) / 2) * this.g.cs; }
    wz(r) { return (r - (this.g.h - 1) / 2) * this.g.cs; }
    hAt(c, r) { return (UI.M.sample(this.g, this.z, r, c) - this.z0) * this.vex; }

    _buildSkirt() {
      const g = this.g, z = this.z;
      const base = this.zMin - Math.max(80, (this.zMax - this.zMin) * 0.12);
      const edge = [];
      for (const c of this.cols) edge.push([c, 0, 0, -1]);
      for (const r of this.rows) edge.push([g.w - 1, r, 1, 0]);
      for (const c of this.cols.slice().reverse()) edge.push([c, g.h - 1, 0, 1]);
      for (const r of this.rows.slice().reverse()) edge.push([0, r, -1, 0]);
      const n = edge.length;
      const pos = new Float32Array(n * 2 * 3), nor = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
      edge.forEach(([c, r, nxv, nzv], k) => {
        const x = this.wx(c), zz = this.wz(r);
        pos.set([x, z[r * g.w + c], zz, x, base, zz], k * 6);
        nor.set([nxv, 0.25, nzv, nxv, 0.25, nzv], k * 6);
      });
      const idx = new Uint32Array((n - 1) * 6);
      for (let k = 0; k < n - 1; k++) {
        const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.set([a, b, c, c, b, d], k * 6);
      }
      this.skirt = this._upload(this.skirt, pos, nor, uv, idx);
    }

    _normals() {
      if (!this.mesh) return;
      const g = this.g, z = this.z, nx = this.nx, ny = this.ny, vex = this.vex;
      const nor = new Float32Array(nx * ny * 3);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = this.cols[i], r = this.rows[j];
        const c0 = Math.max(0, c - 1), c1 = Math.min(g.w - 1, c + 1), r0 = Math.max(0, r - 1), r1 = Math.min(g.h - 1, r + 1);
        const dx = ((z[r * g.w + c1] - z[r * g.w + c0]) / ((c1 - c0) * g.cs)) * vex;
        const dz = ((z[r1 * g.w + c] - z[r0 * g.w + c]) / ((r1 - r0) * g.cs)) * vex;
        const l = Math.hypot(dx, 1, dz);
        const k = (j * nx + i) * 3;
        nor[k] = -dx / l; nor[k + 1] = 1 / l; nor[k + 2] = -dz / l;
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.nor);
      gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    }

    _upload(old, pos, nor, uv, idx) {
      const gl = this.gl;
      const o = old || { vao: gl.createVertexArray(), pos: gl.createBuffer(), nor: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer() };
      gl.bindVertexArray(o.vao);
      const attr = (buf, data, loc, size) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      attr(o.pos, pos, 0, 3);
      attr(o.nor, nor || new Float32Array(pos.length), 1, 3);
      attr(o.uv, uv, 2, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, o.idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      o.count = idx.length;
      gl.bindVertexArray(null);
      return o;
    }

    setTexture(canvas) {
      if (!this.ok || !canvas) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      this.render();
    }

    setExaggeration(v) {
      this.vex = v;
      if (this.mesh) this._normals();
      this.render();
    }

    home() {
      if (!this.g) return;
      const ext = Math.max(this.g.w, this.g.h) * this.g.cs;
      const aspect = (this.W || 1) / (this.H || 1);
      this.cam = { yaw: 0.4, pitch: 0.6, dist: ext * 1.3 * Math.max(1, 1.45 / aspect), target: [0, 0, 0] };
      this.render();
    }

    lookAtCell(c, r, dist) {
      this.cam.target = [this.wx(c), this.hAt(c, r), this.wz(r)];
      if (dist) this.cam.dist = dist;
      this.render();
    }

    eye() {
      const { yaw, pitch, dist, target } = this.cam;
      return [target[0] + dist * Math.sin(yaw) * Math.cos(pitch), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(yaw) * Math.cos(pitch)];
    }

    _matrices() {
      const ext = Math.max(this.g.w, this.g.h) * this.g.cs;
      const eye = this.cam.eyeOverride || this.eye();
      const tgt = this.cam.targetOverride || this.cam.target;
      const proj = m4.persp((45 * Math.PI) / 180, this.W / this.H, Math.max(5, this.cam.dist * 0.01), ext * 6);
      const view = m4.lookAt(eye, tgt, [0, 1, 0]);
      this.vp = m4.mul(proj, view);
      this.ivp = m4.inv(this.vp);
      this.eyePos = eye;
      return ext;
    }

    render() {
      if (!this.ok || !this.visible) return;
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    }

    draw() {
      const gl = this.gl;
      gl.viewport(0, 0, this.cv.width, this.cv.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const oc = this.octx;
      oc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      oc.clearRect(0, 0, this.W, this.H);
      if (!this.mesh) return;
      const ext = this._matrices();
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(this.u.uMVP, false, this.vp);
      gl.uniform1f(this.u.uVex, this.vex);
      gl.uniform1f(this.u.uZ0, this.z0);
      const az = UI.M.rad(this.app.S.sunAz), alt = UI.M.rad(this.app.S.sunAlt);
      gl.uniform3f(this.u.uSun, Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
      gl.uniform3f(this.u.uEye, ...this.eyePos);
      gl.uniform1f(this.u.uFog, ext);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(this.u.uTex, 0);
      for (const [m, side] of [[this.mesh, 0], [this.skirt, 1]]) {
        gl.uniform1f(this.u.uSide, side);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);
      this._overlay(oc);
    }

    /** World point -> screen (CSS px). */
    project(p) {
      const v = m4.xf(this.vp, [p[0], p[1], p[2], 1]);
      if (v[3] <= 0) return null;
      const x = ((v[0] / v[3]) * 0.5 + 0.5) * this.W, y = (1 - ((v[1] / v[3]) * 0.5 + 0.5)) * this.H;
      return { x, y, depth: v[2] / v[3] };
    }

    _occluded(p) {
      const e = this.eyePos;
      for (let k = 1; k < 40; k++) {
        const t = k / 40;
        const x = e[0] + (p[0] - e[0]) * t, y = e[1] + (p[1] - e[1]) * t, z = e[2] + (p[2] - e[2]) * t;
        const c = x / this.g.cs + (this.g.w - 1) / 2, r = z / this.g.cs + (this.g.h - 1) / 2;
        if (c < 0 || r < 0 || c > this.g.w - 1 || r > this.g.h - 1) continue;
        if (this.hAt(c, r) > y + 3 && t < 0.97) return true;
      }
      return false;
    }

    _overlay(ctx) {
      const S = this.app.S;
      if (!S.show.symbols) return;
      const items = UI.symbolItems(S);
      UI.drawSymbols(ctx, items, (c, r) => {
        const w = [this.wx(c), this.hAt(c, r) + 2, this.wz(r)];
        const p = this.project(w);
        if (!p || p.x < -50 || p.y < -50 || p.x > this.W + 50 || p.y > this.H + 50) return null;
        p.hidden = this._occluded(w);
        return p;
      }, { size: S.symbolSize * 0.9, labels: S.show.labels, lift: 26 });
      // compass
      const yaw = this.cam.yaw;
      ctx.save();
      ctx.translate(this.W - 34, this.H - 40);
      ctx.rotate(yaw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(7, 8); ctx.lineTo(0, 3); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      UI.haloText(ctx, 'N', this.W - 34 + Math.sin(yaw) * 26, this.H - 40 - Math.cos(yaw) * 26, { align: 'center', font: '700 11px "Segoe UI", Arial' });
      UI.haloText(ctx, `Vertical exaggeration ${this.vex.toFixed(1)}×`, 12, this.H - 14, { font: '11px "Segoe UI", Arial', color: '#c8d2c8' });
    }

    /** Screen (CSS px) -> grid cell via ray-marching the heightfield. */
    pick(x, y) {
      if (!this.mesh || !this.ivp) return null;
      const nx = (x / this.W) * 2 - 1, ny = 1 - (y / this.H) * 2;
      const a = m4.xf(this.ivp, [nx, ny, -1, 1]), b = m4.xf(this.ivp, [nx, ny, 1, 1]);
      const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      const dir = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const len = Math.hypot(...dir);
      const step = this.g.cs * 0.75;
      const n = Math.min(6000, Math.ceil(len / step));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const px = p0[0] + dir[0] * t, py = p0[1] + dir[1] * t, pz = p0[2] + dir[2] * t;
        const c = px / this.g.cs + (this.g.w - 1) / 2, r = pz / this.g.cs + (this.g.h - 1) / 2;
        const inside = c >= 0 && r >= 0 && c <= this.g.w - 1 && r <= this.g.h - 1;
        if (inside && this.hAt(c, r) >= py) return prev ? [(c + prev[0]) / 2, (r + prev[1]) / 2] : [c, r];
        prev = inside ? [c, r] : null;
      }
      return null;
    }

    /** Fly the camera along a cell polyline. */
    fly(line, onEnd) {
      this.stopFly();
      const g = this.g;
      const pts = [];
      for (let k = 1; k < line.length; k++) {
        const [c0, r0] = line[k - 1], [c1, r1] = line[k];
        const n = Math.max(1, Math.ceil(Math.hypot(c1 - c0, r1 - r0)));
        for (let s = 0; s < n; s++) pts.push([c0 + ((c1 - c0) * s) / n, r0 + ((r1 - r0) * s) / n]);
      }
      pts.push(line[line.length - 1]);
      const speed = 260; // m per second of animation
      const total = pts.length * g.cs;
      const t0 = performance.now();
      const at = (d) => {
        const f = Math.min(pts.length - 1, Math.max(0, d / g.cs));
        const i = Math.floor(f), u = f - i, j = Math.min(pts.length - 1, i + 1);
        return [pts[i][0] + (pts[j][0] - pts[i][0]) * u, pts[i][1] + (pts[j][1] - pts[i][1]) * u];
      };
      const tick = (now) => {
        const d = ((now - t0) / 1000) * speed;
        if (d > total || !this._flying) { this.stopFly(); onEnd && onEnd(); return; }
        const [c, r] = at(d), [ca, ra] = at(d + 450), [cb, rb] = at(Math.max(0, d - 350));
        const eyeH = Math.max(this.hAt(cb, rb), this.hAt(c, r)) + 140 * this.vex;
        this.cam.eyeOverride = [this.wx(cb), eyeH, this.wz(rb)];
        this.cam.targetOverride = [this.wx(ca), this.hAt(ca, ra) + 20, this.wz(ra)];
        this.draw();
        this._flyRaf = requestAnimationFrame(tick);
      };
      this._flying = true;
      this._flyRaf = requestAnimationFrame(tick);
    }

    stopFly() {
      this._flying = false;
      if (this._flyRaf) cancelAnimationFrame(this._flyRaf);
      this._flyRaf = 0;
      if (this.cam.eyeOverride) {
        // keep the final view as the new orbit pose
        const e = this.cam.eyeOverride, t = this.cam.targetOverride;
        const dx = e[0] - t[0], dy = e[1] - t[1], dz = e[2] - t[2];
        const dist = Math.hypot(dx, dy, dz);
        this.cam = { yaw: Math.atan2(dx, dz), pitch: Math.asin(dy / dist), dist, target: t };
      }
      this.render();
    }

    _bind() {
      const cv = this.cv;
      let drag = null;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('mousedown', (e) => {
        if (this._flying) this.stopFly();
        const [x, y] = pos(e);
        drag = { x, y, lx: x, ly: y, pan: e.button === 2 || e.shiftKey, moved: false };
      });
      window.addEventListener('mousemove', (e) => {
        const [x, y] = pos(e);
        if (drag) {
          const dx = x - drag.lx, dy = y - drag.ly;
          if (Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true;
          drag.lx = x; drag.ly = y;
          if (!drag.moved) return;
          if (drag.pan) {
            const k = this.cam.dist / this.H * 1.2;
            const s = Math.sin(this.cam.yaw), c = Math.cos(this.cam.yaw);
            this.cam.target[0] += (-dx * c - dy * s) * k;
            this.cam.target[2] += (dx * s - dy * c) * k;
          } else {
            this.cam.yaw -= dx * 0.006;
            this.cam.pitch = Math.min(1.52, Math.max(0.06, this.cam.pitch + dy * 0.005));
          }
          this.render();
        } else if (e.target === cv) {
          if (this._hoverPending) return;
          this._hoverPending = true;
          requestAnimationFrame(() => {
            this._hoverPending = false;
            const cell = this.pick(x, y);
            if (cell) this.app.onHover(cell[0], cell[1], x, y); else this.app.onHover(null);
          });
        }
      });
      window.addEventListener('mouseup', (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        if (!d.moved && e.target === cv && e.button === 0) {
          const [x, y] = pos(e);
          const cell = this.pick(x, y);
          if (cell) this.app.onClick(cell[0], cell[1], { x, y, view3d: true });
        }
      });
      cv.addEventListener('dblclick', (e) => {
        const [x, y] = pos(e);
        const cell = this.pick(x, y);
        if (!cell) return;
        if (this.app.S.draft) { this.app.onDblClick(cell[0], cell[1]); return; }
        this.lookAtCell(cell[0], cell[1], this.cam.dist * 0.6);
      });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const ext = Math.max(this.g ? this.g.w * this.g.cs : 1e4, 1000);
        this.cam.dist = Math.min(ext * 4, Math.max(150, this.cam.dist * Math.pow(1.0015, e.deltaY)));
        this.render();
      }, { passive: false });
      // touch: one finger orbit, two fingers zoom
      let t0 = null;
      cv.addEventListener('touchstart', (e) => { t0 = { ts: [...e.touches].map(pos), yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist }; }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        if (!t0) return;
        e.preventDefault();
        const ts = [...e.touches].map(pos);
        if (ts.length === 1 && t0.ts.length === 1) {
          this.cam.yaw = t0.yaw - (ts[0][0] - t0.ts[0][0]) * 0.006;
          this.cam.pitch = Math.min(1.52, Math.max(0.06, t0.pitch + (ts[0][1] - t0.ts[0][1]) * 0.005));
        } else if (ts.length === 2 && t0.ts.length === 2) {
          const d0 = Math.hypot(t0.ts[0][0] - t0.ts[1][0], t0.ts[0][1] - t0.ts[1][1]);
          const d1 = Math.hypot(ts[0][0] - ts[1][0], ts[0][1] - ts[1][1]);
          this.cam.dist = t0.dist * (d0 / d1);
        }
        this.render();
      }, { passive: false });
      cv.addEventListener('touchend', (e) => { if (!e.touches.length) t0 = null; });
    }
  }

  UI.View3D = View3D;
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
