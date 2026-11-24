import { targetRadius } from '../game/data';
import { innerRadius } from '../game/physics';
import type { Order, Workpiece } from '../game/types';

const RADIAL_SEGMENTS = 56;
const FLOATS_PER_VERTEX = 8;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建 WebGL2 shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader 编译失败: ${log}\n${source}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建 WebGL2 program');
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program 链接失败: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function perspective(out: Float32Array, fovy: number, aspect: number, near: number, far: number): void {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function lookAt(out: Float32Array, eye: number[], center: number[], up: number[]): void {
  let z0 = eye[0] - center[0];
  let z1 = eye[1] - center[1];
  let z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;
  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2) || 1;
  x0 /= len; x1 /= len; x2 /= len;
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
}

function multiply(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
}

const glassVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aTemp;
layout(location=3) in float aCrack;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vWorld;
out float vTemp;
out float vCrack;
void main() {
  vNormal = aNormal;
  vWorld = aPosition;
  vTemp = aTemp;
  vCrack = aCrack;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const glassFS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in float vTemp;
in float vCrack;
uniform vec3 uBaseColor;
uniform vec3 uCamera;
uniform float uOpacity;
out vec4 outColor;

vec3 temperatureGlow(float t) {
  float h = clamp((t - 470.0) / 780.0, 0.0, 1.0);
  vec3 coldRed = vec3(0.34, 0.025, 0.012);
  vec3 orange = vec3(1.0, 0.24, 0.025);
  vec3 amber = vec3(1.0, 0.68, 0.16);
  vec3 whiteHot = vec3(1.0, 0.96, 0.82);
  vec3 c = mix(coldRed, orange, smoothstep(0.0, 0.38, h));
  c = mix(c, amber, smoothstep(0.28, 0.72, h));
  c = mix(c, whiteHot, smoothstep(0.68, 1.0, h));
  return c;
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(vec3(-0.38, 0.72, 0.72));
  float diffuse = abs(dot(N, L));
  vec3 V = normalize(uCamera - vWorld);
  float facing = abs(dot(N, V));
  float fresnel = pow(1.0 - facing, 2.35);
  vec3 H = normalize(L + V);
  float specular = pow(max(abs(dot(N, H)), 0.0), 92.0);
  float heat = smoothstep(500.0, 1160.0, vTemp);
  vec3 glow = temperatureGlow(vTemp) * heat;

  vec3 color = uBaseColor * (0.16 + 0.5 * diffuse);
  color += vec3(0.78, 0.94, 1.0) * specular * 1.65;
  color += fresnel * mix(uBaseColor, vec3(0.85, 0.96, 1.0), 0.65) * 1.25;
  color += glow * (1.15 + 0.45 * sin(vWorld.x * 90.0));
  color = mix(color, vec3(0.012, 0.018, 0.024), clamp(vCrack * 1.55, 0.0, 0.88));

  float alpha = uOpacity + fresnel * 0.34 + heat * 0.13 + specular * 0.25;
  alpha = mix(alpha, 0.92, clamp(vCrack, 0.0, 0.7));
  outColor = vec4(color, clamp(alpha, 0.05, 0.88));
}`;

const lineVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPosition, 1.0); }`;

const lineFS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

export class GlassRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private glassProgram: WebGLProgram;
  private lineProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private lineVao: WebGLVertexArrayObject;
  private lineVbo: WebGLBuffer;
  private pipeVao: WebGLVertexArrayObject;
  private pipeCount = 0;
  private pipeIndexCount = 0;

  private projection = new Float32Array(16);
  private view = new Float32Array(16);
  private viewProj = new Float32Array(16);
  private yaw = -0.42;
  private pitch = 0.22;
  private distance = 0.58;
  private camera: [number, number, number] = [0.22, 0.16, 0.54];
  private target: [number, number, number] = [0.005, -0.018, 0];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器或设备未启用 WebGL2。');
    this.gl = gl;
    this.glassProgram = createProgram(gl, glassVS, glassFS);
    this.lineProgram = createProgram(gl, lineVS, lineFS);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vao || !vbo || !ibo) throw new Error('无法创建 WebGL2 几何缓冲。');
    this.vao = vao;
    this.vbo = vbo;
    this.ibo = ibo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
    gl.bindVertexArray(null);

    const lineVao = gl.createVertexArray();
    const lineVbo = gl.createBuffer();
    if (!lineVao || !lineVbo) throw new Error('无法创建线条缓冲。');
    this.lineVao = lineVao;
    this.lineVbo = lineVbo;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    const pipe = this.createPipe();
    this.pipeVao = pipe.vao;
    this.pipeCount = pipe.vertexCount;
    this.pipeIndexCount = pipe.indexCount;
    this.attachPointerControls();
  }

  private attachPointerControls(): void {
    let active = false;
    let lastX = 0;
    let lastY = 0;
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', (event) => {
      active = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!active) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.yaw += dx * 0.008;
      this.pitch = Math.max(-1.15, Math.min(1.15, this.pitch + dy * 0.006));
    });
    const stop = (): void => { active = false; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distance = Math.max(0.3, Math.min(1.25, this.distance + event.deltaY * 0.00055));
      },
      { passive: false },
    );
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  private updateCamera(): void {
    const gl = this.gl;
    this.resize();
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    perspective(this.projection, Math.PI / 4.6, aspect, 0.01, 5);
    const cp = Math.cos(this.pitch);
    this.camera = [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch) + 0.035,
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
    lookAt(this.view, this.camera, this.target, [0, 1, 0]);
    multiply(this.viewProj, this.projection, this.view);
    gl.clearColor(0.025, 0.038, 0.055, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  render(wp: Workpiece | null, target?: Order, toolU = 0.68): void {
    const gl = this.gl;
    this.updateCamera();

    this.drawPipe();

    if (target) this.drawTarget(target);
    if (wp) {
      this.drawGlass(wp);
      this.drawToolRing(wp, toolU);
    }
  }

  private createPipe(): { vao: WebGLVertexArrayObject; vertexCount: number; indexCount: number } {
    const gl = this.gl;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const seg = 28;
    const x0 = -0.42;
    const x1 = -0.112;
    const radius = 0.0115;
    for (let end = 0; end < 2; end += 1) {
      const x = end === 0 ? x0 : x1;
      for (let k = 0; k < seg; k += 1) {
        const a = (k / seg) * Math.PI * 2;
        const cy = Math.cos(a);
        const sz = Math.sin(a);
        positions.push(x, radius * cy, radius * sz);
        normals.push(0, cy, sz);
      }
    }
    for (let k = 0; k < seg; k += 1) {
      const a = k;
      const b = (k + 1) % seg;
      const c = seg + k;
      const d = seg + ((k + 1) % seg);
      indices.push(a, c, b, b, c, d);
    }
    // Mouth ring at x1 gives a slightly thicker metal collar.
    const collarStart = positions.length / 3;
    for (let k = 0; k < seg; k += 1) {
      const a = (k / seg) * Math.PI * 2;
      positions.push(x1 - 0.018, radius * 1.45 * Math.cos(a), radius * 1.45 * Math.sin(a));
      normals.push(0, Math.cos(a), Math.sin(a));
    }
    for (let k = 0; k < seg; k += 1) {
      const a = collarStart + k;
      const b = collarStart + ((k + 1) % seg);
      const c = seg + k;
      const d = seg + ((k + 1) % seg);
      indices.push(a, c, b, b, c, d);
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vertexCount: positions.length / 3, indexCount: indices.length };
  }

  private drawPipe(): void {
    const gl = this.gl;
    gl.useProgram(this.glassProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.glassProgram, 'uViewProj'), false, this.viewProj);
    gl.uniform3f(gl.getUniformLocation(this.glassProgram, 'uCamera'), ...this.camera);
    gl.uniform3f(gl.getUniformLocation(this.glassProgram, 'uBaseColor'), 0.16, 0.18, 0.21);
    gl.uniform1f(gl.getUniformLocation(this.glassProgram, 'uOpacity'), 1);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(this.pipeVao);
    gl.drawElements(gl.TRIANGLES, this.pipeIndexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  private buildGlass(wp: Workpiece): { data: Float32Array; indices: Uint16Array } {
    const n = wp.activeCells;
    const ringCount = n + 1;
    const outerOffset = 0;
    const innerOffset = ringCount * RADIAL_SEGMENTS;
    const vertexCount = ringCount * RADIAL_SEGMENTS * 2 + 1;
    const data: number[] = [];
    const indices: number[] = [];
    const xShift = -0.115;

    const radii = new Float32Array(ringCount);
    const innerRadii = new Float32Array(ringCount);
    const temps = new Float32Array(ringCount);
    const cracks = new Float32Array(ringCount);
    for (let i = 0; i < ringCount; i += 1) {
      const ci = Math.min(n - 1, Math.max(0, i === 0 ? 0 : i - 1));
      radii[i] = i === 0 ? wp.R[0] : i === n ? wp.R[n - 1] : (wp.R[i - 1] + wp.R[i]) * 0.5;
      innerRadii[i] = innerRadius(wp, ci);
      temps[i] = wp.T[ci * wp.radialLayers + 2];
      cracks[i] = wp.crack[ci];
    }

    const pushRing = (inner: boolean, offset: number): void => {
      for (let i = 0; i < ringCount; i += 1) {
        const prev = Math.max(0, i - 1);
        const next = Math.min(n, i + 1);
        const xPrev = wp.centerX[prev] + xShift;
        const xNext = wp.centerX[next] + xShift;
        const yPrev = wp.sag[prev];
        const yNext = wp.sag[next];
        let tx = xNext - xPrev;
        let ty = yNext - yPrev;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const nx = -ty;
        const ny = tx;
        const r = inner ? innerRadii[i] : radii[i];
        const rPrev = inner ? innerRadii[prev] : radii[prev];
        const rNext = inner ? innerRadii[next] : radii[next];
        const drds = (rNext - rPrev) / Math.max(0.002, Math.hypot(xNext - xPrev, yNext - yPrev));
        const cx = wp.centerX[i] + xShift;
        const cy = wp.sag[i];

        for (let k = 0; k < RADIAL_SEGMENTS; k += 1) {
          const a = (k / RADIAL_SEGMENTS) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const mx = nx * ca;
          const my = ny * ca;
          const mz = sa;
          let nxn = mx - drds * tx;
          let nyn = my - drds * ty;
          let nzn = mz;
          const nl = Math.hypot(nxn, nyn, nzn) || 1;
          nxn /= nl; nyn /= nl; nzn /= nl;
          if (inner) {
            nxn = -nxn; nyn = -nyn; nzn = -nzn;
          }
          data.push(cx + r * mx, cy + r * my, r * mz);
          data.push(nxn, nyn, nzn);
          data.push(temps[i], cracks[i]);
        }
      }
    };

    pushRing(false, outerOffset);
    pushRing(true, innerOffset);

    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < RADIAL_SEGMENTS; k += 1) {
        const k1 = (k + 1) % RADIAL_SEGMENTS;
        const a = outerOffset + i * RADIAL_SEGMENTS + k;
        const b = outerOffset + i * RADIAL_SEGMENTS + k1;
        const c = outerOffset + (i + 1) * RADIAL_SEGMENTS + k;
        const d = outerOffset + (i + 1) * RADIAL_SEGMENTS + k1;
        indices.push(a, c, b, b, c, d);

        const ia = innerOffset + i * RADIAL_SEGMENTS + k;
        const ib = innerOffset + i * RADIAL_SEGMENTS + k1;
        const ic = innerOffset + (i + 1) * RADIAL_SEGMENTS + k;
        const id = innerOffset + (i + 1) * RADIAL_SEGMENTS + k1;
        indices.push(ia, ib, ic, ib, id, ic);
      }
    }

    // Mouth rim after cutting.
    if (wp.activeCells < wp.cellCount) {
      const last = n;
      for (let k = 0; k < RADIAL_SEGMENTS; k += 1) {
        const k1 = (k + 1) % RADIAL_SEGMENTS;
        const o0 = outerOffset + last * RADIAL_SEGMENTS + k;
        const o1 = outerOffset + last * RADIAL_SEGMENTS + k1;
        const i0 = innerOffset + last * RADIAL_SEGMENTS + k;
        const i1 = innerOffset + last * RADIAL_SEGMENTS + k1;
        indices.push(o0, i0, o1, o1, i0, i1);
      }
    } else {
      // Closed gather/tip cap before trimming.
      const centerIndex = vertexCount - 1;
      const last = n;
      data.push(wp.centerX[last] + xShift, wp.sag[last], 0, 1, 0, 0, temps[last], cracks[last]);
      for (let k = 0; k < RADIAL_SEGMENTS; k += 1) {
        const k1 = (k + 1) % RADIAL_SEGMENTS;
        const a = outerOffset + last * RADIAL_SEGMENTS + k;
        const b = outerOffset + last * RADIAL_SEGMENTS + k1;
        indices.push(centerIndex, b, a);
      }
    }

    return {
      data: new Float32Array(data),
      indices: new Uint16Array(indices),
    };
  }

  private drawGlass(wp: Workpiece): void {
    const gl = this.gl;
    const mesh = this.buildGlass(wp);
    gl.useProgram(this.glassProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.glassProgram, 'uViewProj'), false, this.viewProj);
    gl.uniform3f(gl.getUniformLocation(this.glassProgram, 'uCamera'), ...this.camera);
    const recipeColor = this.recipeColor(wp.recipeId);
    gl.uniform3f(gl.getUniformLocation(this.glassProgram, 'uBaseColor'), recipeColor[0], recipeColor[1], recipeColor[2]);
    gl.uniform1f(gl.getUniformLocation(this.glassProgram, 'uOpacity'), this.recipeOpacity(wp.recipeId));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
  }

  private recipeColor(id: string): [number, number, number] {
    if (id === 'lead-crystal') return [1.0, 0.78, 0.34];
    if (id === 'borosilicate') return [0.55, 0.95, 0.86];
    if (id === 'fused-quartz') return [0.82, 0.91, 1.0];
    return [0.55, 0.86, 1.0];
  }

  private recipeOpacity(id: string): number {
    if (id === 'fused-quartz') return 0.22;
    if (id === 'lead-crystal') return 0.3;
    return 0.34;
  }

  private drawLinePositions(positions: Float32Array, color: [number, number, number, number], mode: number): void {
    const gl = this.gl;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uViewProj'), false, this.viewProj);
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, 'uColor'), color[0], color[1], color[2], color[3]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.drawArrays(mode, 0, positions.length / 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
  }

  private drawTarget(order: Order): void {
    const samples = 72;
    const positions: number[] = [];
    for (let s = 0; s < samples - 1; s += 1) {
      const u0 = s / (samples - 1);
      const u1 = (s + 1) / (samples - 1);
      const x0 = u0 * order.profile.height - 0.115;
      const x1 = u1 * order.profile.height - 0.115;
      const r0 = targetRadius(order.profile, u0);
      const r1 = targetRadius(order.profile, u1);
      positions.push(x0, r0, 0, x1, r1, 0);
      positions.push(x0, -r0, 0, x1, -r1, 0);
    }
    this.drawLinePositions(new Float32Array(positions), [0.35, 0.95, 1.0, 0.42], this.gl.LINES);
  }

  private drawToolRing(wp: Workpiece, toolU: number): void {
    const n = wp.activeCells;
    const idx = Math.max(0, Math.min(n - 1, Math.round(toolU * (n - 1))));
    const node = idx;
    const x = wp.centerX[node] - 0.115;
    const y = wp.sag[node];
    const prev = Math.max(0, node - 1);
    const next = Math.min(n, node + 1);
    let tx = wp.centerX[next] - wp.centerX[prev];
    let ty = wp.sag[next] - wp.sag[prev];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty;
    const ny = tx;
    const r = wp.R[idx] * 1.16;
    const positions: number[] = [];
    for (let k = 0; k < RADIAL_SEGMENTS; k += 1) {
      const a = (k / RADIAL_SEGMENTS) * Math.PI * 2;
      positions.push(x + r * Math.cos(a) * nx, y + r * Math.cos(a) * ny, r * Math.sin(a));
    }
    this.drawLinePositions(new Float32Array(positions), [1.0, 0.58, 0.16, 0.95], this.gl.LINE_LOOP);
  }
}
