# 炽璃工坊 · Thermal Glass Workshop Sim

一个以“温度—黏度—变形”为核心的玻璃工坊模拟游戏。玩家从熔炉挑出玻璃料，通过吹气、转管、夹压、剪切和回炉控制温度场与轮廓，完成茶杯、花瓶、凉水壶和光学浅钵订单，再经营设备与工坊。

技术栈：**TypeScript + Vite + 原生 WebGL2 + Canvas2D 数据图表**。没有使用游戏引擎或 Three.js，玻璃车削网格、中心线弯曲、口沿和内壁均由代码生成。

## 运行

```powershell
npm install
npm run dev
```

浏览器打开 Vite 输出的 `http://127.0.0.1:5173/`。

生产构建：

```powershell
npm run build
npm run preview
```

## 页面

- **工作台**：WebGL2 实时玻璃视图、配方选择、挑料、吹气、回炉、转管、夹/压、剪口、退火控制和实时物理量。
- **温度分布**：42 轴向段 × 5 径向层温度热图、径向截面、VFT 黏度曲线、退火温度/应力曲线和临界冷速。
- **作品订单**：6 个自编客户订单，包含杯、花瓶、凉水壶、婚礼细颈瓶和石英钵；每个订单有目标轮廓、容差、最低评分、数量、赏金和声望。
- **工坊经营**：现金、声望、完成数、失败数、成品库、代售、5 类升级和 4 种玻璃配方物性表。经济与升级保存在 `localStorage`。

## 操作

- 按住 **吹气** 或按 `Space`：软的区域先膨胀，薄壁环向应力更高，因此会越鼓越快。
- 按住 **回炉** 或按 `H`：进入聚焰炉辐射加热，表面先升温。
- 转速滑杆或 **停 / 慢转 / 稳转 / 快转**：
  - 停转且玻璃热软时，重力弯矩使中心线明显下垂；
  - 稳转会均化重力的周向作用并帮助找直；
  - 高速产生集中在口沿的离心应力，使口沿张开。
- **夹颈 / 压肩** 或按 `J` / `F`：在设定轴向位置和宽度施加黏性压缩；外表面低于工具安全温度时会累积裂纹。
- **剪口/修短**：按设定位置切去料头。温度过低会崩裂。
- 轮廓满意后选择 **标准慢冷 / 快速退火 / 直接风冷 / 自定义冷速**。退火窑支持 `30×–600×` 时间倍率。
- 完成后先 **收入作品库**，再到订单页选择对应成品交付；也可以在工坊经营页直接代售。

## 物理模型

### VFT 黏度

每种配方使用独立 VFT 参数：

\[
\log_{10}\eta(T)=A+\frac{B}{(T+273.15)-T_0}
\]

变形使用五层温度的平均流动度 \(1/\eta\) 求有效黏度，因此最热、最软的层会主导变形。

配方：

1. 钠钙透明玻璃：工作区间宽，适合新手。
2. 铅晶玻璃：低温柔软、密度高、离心张口明显。
3. 硼硅硬质玻璃：低膨胀、抗热震，但需要更高炉温。
4. 熔融石英：极高工作温度、低热膨胀，需要“高温熔窑”升级。

### 传热

每个轴向段把壁厚分成 5 个径向有限体积层：

\[
\rho c_p\Delta r\,\frac{dT_j}{dt}
=
\frac{k}{\Delta r}(T_{j-1}-2T_j+T_{j+1})
+q_{\text{rad}}+q_{\text{conv}}
\]

外表面包括 Stefan–Boltzmann 辐射和对流；内壁有吹气/空气换热，贴管端有额外冷传导。显式积分使用基于 \(\Delta r^2/\alpha\) 的稳定子步长。薄壁的热容量和传导距离同时下降，所以冷得更快。

### 变形

- 吹胀/离心：

\[
\dot\varepsilon_r=
\frac{pR/(2w)+\rho\Omega^2R^2f_{\text{rim}}(u)}{3\eta_{\text{eff}}}
\]

- 重力：把远端玻璃质量形成的弯矩作用在黏性截面惯性矩 \(\pi R^3w\) 上，积分成弯曲中心线。
- 夹压：局部黏性径向压缩，并在半径过小时按体积守恒增加局部长度。
- 冷裂：外表面越低于配方的工具安全温度，裂纹累积越快；裂纹会降低退火时的破裂强度。

### 退火与应力判定

厚壁处的临界冷速按热扩散、弹性约束和破裂强度估算：

\[
q_c\propto
\frac{\alpha_{\text{th}}\sigma_{\text{fail}}(1-\nu)}
{E\alpha_{\text{exp}}w^2}
\]

退火过程中更新径向温差产生的热弹性应力、Maxwell 松弛，以及越过退火点—应变点黏度区间时锁定的应力。是否炸裂只由实际应力是否超过该截面的破裂强度决定；已有裂纹会降低强度。标准程序通常幸存，明显超过临界冷速的快速/风冷会产生高应力并可能炸裂。

## 性能

物理网格为 42 轴向单元 × 5 径向温度层。Node 巡检中完整工作步进约 `0.04–0.15 ms/帧`，显著低于 60 FPS 的 16.7 ms CPU 预算。WebGL2 每帧动态上传约 5k 顶点的车削网格，在独立显卡/核显上可实时运行；无头 SwiftShader 的 FPS 不代表真实 GPU 性能。

## 无浏览器仿真巡检

这些脚本只导入游戏核心，可用于调整数值：

```powershell
npx esbuild scripts/check-sim.ts --bundle --platform=node --format=esm --outfile=scripts/.check-sim.mjs
node scripts/.check-sim.mjs

npx esbuild scripts/gravity-check.ts --bundle --platform=node --format=esm --outfile=scripts/.gravity-check.mjs
node scripts/.gravity-check.mjs
```

浏览器冒烟测试需要先启动 `npm run preview`，再启动带远程调试端口的 Chrome/Edge：

```powershell
$env:CDP_URL="http://127.0.0.1:9333"
node scripts/browser-smoke.mjs
```

## 目录

```text
src/
  game/
    types.ts       # 所有状态、订单、退火和控制类型
    data.ts        # 配方、6 个订单、升级、目标轮廓
    physics.ts     # VFT、传热、吹/转/重力/工具、评分、退火应力
    store.ts       # 经济、订单交付、升级、localStorage
  render/
    GlassRenderer.ts # 原生 WebGL2 车削/内壁/口沿/目标线/工具环
  ui/
    app.ts         # 四页布局、控件、主循环、DOM 更新
    charts.ts      # Canvas2D 温度热图、VFT、退火曲线
  style.css
  main.ts
scripts/           # 可选的物理与 CDP 冒烟巡检
```
