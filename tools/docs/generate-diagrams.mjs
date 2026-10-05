import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../docs/diagrams/', import.meta.url));
const palettes = {
  light: {
    ink: '#202735',
    muted: '#637084',
    accent: '#5546ab',
    good: '#24613f',
    warn: '#965200',
    paper: '#ffffff',
    fill: '#efecfa',
    soft: '#f3f5f7',
    green: '#e8f3ea',
    yellow: '#fff3d6',
    red: '#a63232',
  },
  dark: {
    ink: '#edf0f6',
    muted: '#b5bfce',
    accent: '#c2b6ff',
    good: '#96d7ae',
    warn: '#ffd596',
    paper: '#20252e',
    fill: '#38304e',
    soft: '#292f3a',
    green: '#233d30',
    yellow: '#493923',
    red: '#ffa0a0',
  },
};

function seed(value) {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 1;
}

// Coordinates are the authoring source; IDs and roughness seeds stay stable across regeneration.
function drawing(id, theme) {
  const p = palettes[theme];
  const elements = [];
  function shape(type, x, y, width, height, extras = {}) {
    const key = `${id}-${elements.length}`;
    const e = {
      id: key,
      type,
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: p.ink,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1.25,
      strokeStyle: 'solid',
      roughness: 0.65,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: seed(key),
      version: 1,
      versionNonce: seed(`${key}-v`),
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      ...extras,
    };
    elements.push(e);
    return e;
  }
  function rect(x, y, w, h, fill = 'paper', stroke = 'ink', dashed = false) {
    return shape('rectangle', x, y, w, h, {
      backgroundColor: p[fill] ?? fill,
      strokeColor: p[stroke],
      strokeStyle: dashed ? 'dashed' : 'solid',
    });
  }
  function ellipse(x, y, w, h, fill = 'paper', stroke = 'ink') {
    return shape('ellipse', x, y, w, h, { backgroundColor: p[fill], strokeColor: p[stroke] });
  }
  function text(x, y, value, size = 16, color = 'ink') {
    const lines = value.split('\n');
    const width =
      Math.max(
        ...lines.map((line) =>
          [...line].reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.57) * size, 0),
        ),
      ) + 4;
    return shape('text', x, y, width, lines.length * size * 1.25, {
      text: value,
      originalText: value,
      fontSize: size,
      fontFamily: 5,
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      strokeColor: p[color],
    });
  }
  function path(points, color = 'muted', arrow = false, dashed = false) {
    const [startX, startY] = points[0];
    return shape(
      arrow ? 'arrow' : 'line',
      startX,
      startY,
      Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)),
      Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y)),
      {
        points: points.map(([x, y]) => [x - startX, y - startY]),
        strokeColor: p[color],
        strokeStyle: dashed ? 'dashed' : 'solid',
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: arrow ? 'arrow' : null,
        elbowed: false,
      },
    );
  }
  const line = (x1, y1, x2, y2, color = 'muted') =>
    path(
      [
        [x1, y1],
        [x2, y2],
      ],
      color,
    );
  const arrow = (x1, y1, x2, y2, color = 'accent', dashed = false) =>
    path(
      [
        [x1, y1],
        [x2, y2],
      ],
      color,
      true,
      dashed,
    );
  function button(x, y, w, label, fill = 'soft') {
    rect(x, y, w, 34, fill, 'muted');
    const caption = text(x, y, label, 14);
    caption.x = x + (w - caption.width) / 2;
    caption.y = y + (34 - caption.height) / 2;
  }
  function bars(x, y, w, count = 4, gap = 22) {
    for (let i = 0; i < count; i++)
      line(x, y + i * gap, x + w * (i === count - 1 ? 0.67 : 1), y + i * gap);
  }
  function paper(x, y, w, h, label, fill = 'paper') {
    rect(x, y, w, h, fill);
    line(x + w - 24, y, x + w - 24, y + 24);
    line(x + w - 24, y + 24, x + w, y + 24);
    text(x + 14, y + 30, label, 16);
    bars(x + 14, y + 70, w - 30, 3, Math.min(22, (h - 88) / 2));
  }
  function browser(x, y, w, h, title) {
    rect(x, y, w, h);
    line(x, y + 55, x + w, y + 55);
    ellipse(x + 13, y + 16, 8, 8, 'soft');
    ellipse(x + 29, y + 16, 8, 8, 'soft');
    rect(x + 50, y + 9, w - 65, 31, 'soft', 'muted');
    text(x + 63, y + 15, title, 14);
  }
  function laptop(x, y, w, label) {
    rect(x, y, w, w * 0.63, 'soft');
    rect(x + 10, y + 10, w - 20, w * 0.63 - 22, 'paper', 'muted');
    path([
      [x - 12, y + w * 0.63],
      [x + w + 12, y + w * 0.63],
      [x + w + 23, y + w * 0.63 + 16],
      [x - 23, y + w * 0.63 + 16],
      [x - 12, y + w * 0.63],
    ]);
    text(x + 24, y + 24, label, 16);
    const glyphSize = Math.min(40, w * 0.2);
    const glyphY = y + w * 0.63 - 14 - glyphSize;
    ellipse(x + w / 2 - glyphSize / 2, glyphY, glyphSize, glyphSize, 'fill', 'accent');
    text(x + w / 2 - 5, glyphY + (glyphSize - 20) / 2, 'A', 16, 'accent');
  }
  return {
    p,
    elements,
    rect,
    ellipse,
    text,
    shape,
    path,
    line,
    arrow,
    button,
    bars,
    paper,
    browser,
    laptop,
  };
}

const specs = [
  {
    id: 'sidebar',
    width: 960,
    height: 620,
    title: '网页旁的 Lody 侧栏',
    alt: '示意：左侧是正在阅读的文章，右侧是 Lody 侧栏。顶部管理会话，中间查看回复和来源，底部写问题、添加资料并发送。来源只在你选择或开启当前页面后进入消息。',
    draw(d) {
      const { browser, rect, text, line, bars, arrow, ellipse, path } = d;
      browser(35, 35, 890, 545, 'example.com/article');
      rect(58, 110, 476, 445, 'soft', 'muted');
      text(87, 132, '正在阅读的文章', 20);
      bars(87, 185, 398, 4, 26);
      rect(87, 301, 315, 55, 'fill', 'accent');
      text(99, 314, '作者的两条证据', 16, 'accent');
      bars(87, 389, 370, 4, 26);
      line(560, 90, 560, 580);
      text(580, 110, 'Lody', 18);
      text(749, 114, '历史  +  设置', 14);
      line(575, 152, 909, 152);
      rect(626, 175, 263, 65, 'soft', 'muted');
      text(642, 190, '结论与证据是什么？', 16);
      text(580, 271, '助手', 15, 'accent');
      bars(580, 307, 305, 3, 23);
      rect(582, 401, 185, 35, 'fill', 'accent');
      text(594, 407, '文章 A · 查看资料', 14);
      rect(579, 452, 325, 90, 'paper', 'muted');
      text(592, 466, '问点什么…', 16, 'muted');
      text(592, 507, '+    模型    工具', 14);
      ellipse(860, 504, 30, 30, 'fill', 'accent');
      arrow(868, 527, 880, 512);
      text(582, 553, '当前页面    标签页', 14);
      text(580, 594, '选择对话助手', 14, 'muted');
      path(
        [
          [402, 328],
          [549, 328],
          [549, 419],
          [575, 419],
        ],
        'accent',
        true,
      );
      text(409, 361, '附加', 14, 'accent');
    },
  },
  {
    id: 'connection',
    width: 960,
    height: 590,
    title: '侧栏与运行助手的机器',
    alt: '示意：浏览器先登录并选择工作区，再选运行机器和助手。侧栏的问题经 Lody 交给同一工作区的在线机器，回答回到原会话。机器与浏览器可以在同一台电脑，也可以在不同设备。',
    draw(d) {
      const { rect, text, browser, button, laptop, ellipse, arrow, path, bars } = d;
      rect(25, 90, 900, 400, 'transparent', 'muted', true);
      text(43, 107, '同一工作区', 16, 'accent');
      browser(53, 163, 320, 287, 'Lody 侧栏');
      text(75, 230, '已登录', 15, 'good');
      text(75, 269, '运行于', 14, 'muted');
      button(149, 262, 200, '我的电脑');
      text(75, 315, '助手', 14, 'muted');
      button(149, 308, 200, 'Agent');
      button(246, 392, 100, '完成', 'fill');
      ellipse(466, 222, 122, 108, 'fill', 'accent');
      text(506, 265, 'Lody', 18, 'accent');
      laptop(665, 182, 214, '在线机器');
      text(691, 350, '运行所选 Agent', 16);
      bars(691, 385, 142, 2);
      arrow(382, 265, 456, 265);
      text(391, 235, '问题', 14);
      arrow(594, 265, 653, 265);
      text(594, 233, '处理', 14);
      path(
        [
          [695, 430],
          [695, 463],
          [334, 463],
          [334, 453],
        ],
        'good',
        true,
      );
      text(477, 433, '回答', 16, 'good');
      text(51, 518, '浏览器收集资料', 16);
      text(665, 518, '机器运行助手', 16);
    },
  },
  {
    id: 'snapshot',
    width: 960,
    height: 680,
    title: '固定快照与发送时读取',
    alt: '上半图：手动附加文章 A，草稿保留 A 的快照，即使浏览器切到 B。下半图：开启当前页面，在 B 页面点击发送时读取 B。需要更新固定来源时，由你主动重新读取。',
    draw(d) {
      const { browser, text, bars, rect, paper, arrow, path, line, button } = d;
      text(33, 18, '手动附加', 20);
      browser(38, 66, 247, 201, '文章 A');
      bars(58, 153, 200, 4);
      arrow(294, 168, 374, 168);
      text(295, 130, '读取', 14);
      paper(385, 85, 167, 162, 'A · 10:00', 'fill');
      arrow(562, 168, 638, 168);
      text(575, 130, '加入', 14);
      rect(649, 65, 269, 255, 'paper');
      text(665, 82, '待发送草稿', 18);
      rect(666, 125, 225, 57, 'fill', 'accent');
      text(680, 141, '文章 A · 10:00', 16);
      text(666, 201, '解释作者的证据', 16);
      button(784, 259, 109, '发送', 'fill');
      path(
        [
          [161, 282],
          [161, 316],
          [597, 316],
          [597, 245],
        ],
        'muted',
        true,
        true,
      );
      text(237, 279, '切到 B，A 仍保留', 15, 'muted');
      line(30, 355, 925, 355);
      text(33, 379, '发送时读取', 20);
      browser(38, 430, 247, 201, '文章 B');
      bars(58, 515, 200, 4);
      rect(385, 450, 239, 130, 'soft', 'muted');
      text(401, 467, '当前页面  ✓', 18, 'accent');
      button(493, 521, 109, '发送', 'fill');
      arrow(631, 535, 713, 535);
      text(641, 498, '读取 B', 14);
      paper(725, 453, 176, 176, 'B + 问题', 'fill');
      path(
        [
          [283, 560],
          [333, 560],
          [333, 611],
          [721, 611],
        ],
        'accent',
        true,
      );
      text(391, 620, '发送那一刻的页面', 14, 'accent');
    },
  },
  {
    id: 'media',
    width: 960,
    height: 590,
    title: '从图表截图到附件草稿',
    alt: '示意：从当前可见网页截图，裁剪图表后加入草稿；PDF 文字提取保留页码，确认后以文字文件加入同一草稿。两种资料都需要你点击发送。',
    draw(d) {
      const { browser, text, bars, rect, path, line, arrow, paper, button } = d;
      browser(29, 53, 330, 322, '可见网页');
      text(47, 121, '销售趋势', 18);
      bars(47, 159, 268, 2);
      rect(59, 215, 237, 123, 'fill', 'accent', true);
      line(82, 314, 269, 314);
      line(82, 237, 82, 314);
      path(
        [
          [86, 301],
          [128, 279],
          [171, 287],
          [215, 250],
          [263, 241],
        ],
        'accent',
      );
      text(46, 395, '截图 → 裁剪', 16);
      arrow(365, 275, 420, 275);
      rect(431, 217, 215, 132, 'fill', 'accent');
      path(
        [
          [451, 319],
          [491, 284],
          [533, 294],
          [575, 253],
          [620, 243],
        ],
        'accent',
      );
      text(434, 370, '只保留图表', 16);
      arrow(653, 283, 707, 283);
      rect(717, 112, 211, 350, 'paper');
      text(733, 132, '草稿', 18);
      rect(733, 179, 177, 85, 'fill', 'accent');
      text(749, 203, '图表.png', 16);
      rect(733, 295, 177, 54, 'soft', 'muted');
      text(748, 307, '合同文字.txt', 15);
      button(807, 402, 104, '发送', 'fill');
      paper(51, 463, 202, 102, 'PDF · 第 3 页');
      path(
        [
          [259, 507],
          [684, 507],
          [684, 324],
          [712, 324],
        ],
        'accent',
        true,
      );
      text(343, 476, '预览 → 附加文字', 16);
    },
  },
  {
    id: 'delivery',
    width: 960,
    height: 620,
    title: '送达、回复与中断恢复',
    alt: '正常路径：草稿发送，消息进入原会话，助手再生成回复。连接中断时，草稿和原发送记录保留；确认发送结果会查明同一条消息的送达情况。送达只证明收到消息，不代表助手任务完成。',
    draw(d) {
      const { rect, text, paper, arrow, path, button, line, bars, shape } = d;
      rect(28, 70, 235, 188, 'paper');
      text(46, 87, '本机草稿', 18);
      text(46, 137, '问题 + 资料', 16);
      button(148, 202, 95, '发送', 'fill');
      arrow(272, 163, 365, 163);
      text(283, 122, '提交', 15);
      paper(378, 72, 166, 182, '同一条消息', 'fill');
      text(397, 263, '已送达', 16, 'good');
      arrow(558, 163, 652, 163);
      text(568, 122, '等待回答', 14);
      rect(666, 61, 252, 247, 'paper');
      text(683, 79, '原会话', 18);
      rect(684, 126, 213, 48, 'fill', 'accent');
      text(698, 137, '问题 + 资料', 15);
      text(684, 199, '助手生成中…', 16, 'accent');
      bars(684, 239, 200, 2);
      path(
        [
          [304, 178],
          [304, 385],
          [329, 385],
        ],
        'warn',
        false,
        true,
      );
      text(45, 311, '连接中断', 18, 'warn');
      rect(40, 364, 237, 132, 'yellow', 'warn');
      text(55, 385, '草稿已保留', 18);
      button(55, 440, 204, '确认发送结果', 'yellow');
      shape('diamond', 381, 319, 158, 132, { backgroundColor: d.p.yellow, strokeColor: d.p.warn });
      text(436, 375, '送达？', 16, 'warn');
      path(
        [
          [277, 430],
          [329, 430],
          [329, 385],
          [376, 385],
        ],
        'warn',
        true,
      );
      path(
        [
          [461, 318],
          [461, 284],
        ],
        'warn',
        true,
        true,
      );
      path(
        [
          [547, 388],
          [636, 388],
          [636, 300],
          [660, 300],
        ],
        'good',
        true,
      );
      text(552, 348, '确认原消息', 14, 'good');
      text(383, 520, '继续原会话', 18, 'good');
      path(
        [
          [790, 317],
          [790, 551],
          [575, 551],
        ],
        'good',
        true,
      );
      line(373, 579, 650, 579, 'good');
      text(53, 542, '没有收到确认 ≠ 没有送达', 15, 'warn');
    },
  },
  {
    id: 'schedule',
    width: 960,
    height: 600,
    title: '定时计划交给机器运行',
    alt: '示意：在侧栏填写提示词、机器、时区和重复规则，保存计划。到运行时间，由所选在线机器运行助手，并把结果放进指定会话；关闭浏览器不会把任务转交给浏览器执行。',
    draw(d) {
      const { rect, text, button, arrow, laptop, paper, path, line, ellipse } = d;
      rect(30, 44, 350, 462, 'paper');
      text(48, 64, '定时任务', 20);
      text(48, 109, '任务名称', 14, 'muted');
      button(48, 137, 313, '每周待办');
      text(48, 188, '提示词', 14, 'muted');
      rect(48, 219, 313, 82, 'soft', 'muted');
      text(61, 235, '整理固定资料里的待办', 16);
      text(48, 322, '我的电脑 · Agent', 16);
      button(48, 369, 313, '周一 09:00 · Asia/Shanghai');
      button(212, 443, 149, '保存定时任务', 'fill');
      arrow(389, 217, 471, 217);
      text(398, 179, '保存', 14);
      rect(486, 114, 175, 230, 'fill', 'accent');
      text(503, 129, '计划', 18, 'accent');
      line(486, 177, 661, 177);
      text(504, 189, '一 二 三 四 五', 14);
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 2; j++) rect(504 + i * 29, 226 + j * 36, 22, 25, 'paper', 'muted');
      ellipse(501, 223, 28, 29, 'green', 'good');
      arrow(669, 217, 728, 217);
      text(679, 179, '到点', 14);
      laptop(752, 117, 155, '机器');
      text(750, 249, '在线 → 运行', 16, 'good');
      paper(740, 372, 168, 173, '结果会话', 'green');
      path(
        [
          [828, 282],
          [828, 360],
        ],
        'good',
        true,
      );
      text(482, 426, '浏览器可关闭', 18, 'muted');
      path(
        [
          [575, 351],
          [575, 539],
          [729, 539],
        ],
        'muted',
        true,
        true,
      );
    },
  },
  {
    id: 'sharing',
    width: 960,
    height: 620,
    title: '从私有会话到固定分享',
    alt: '示意：会话先准备固定预览，你核对后才发布成读者链接。新消息继续留在原会话，不会自动加入已发布快照；需要更新时重新预览发布，撤销后阻止后续链接访问。',
    draw(d) {
      const { rect, text, bars, arrow, paper, path, button, browser, line, ellipse } = d;
      rect(28, 66, 239, 303, 'paper');
      text(45, 82, '你的会话', 18);
      rect(46, 128, 202, 48, 'fill', 'accent');
      text(61, 141, '问题 + 资料', 16);
      bars(46, 215, 201, 3);
      button(45, 310, 204, '预览分享内容');
      arrow(279, 230, 360, 230);
      paper(376, 107, 192, 252, '固定预览', 'fill');
      text(393, 281, '核对内容', 16);
      arrow(582, 230, 665, 230);
      text(589, 190, '发布', 16, 'accent');
      browser(681, 121, 239, 263, '读者链接');
      text(700, 198, '分享快照', 18);
      bars(700, 253, 189, 3);
      rect(44, 420, 206, 65, 'soft', 'muted');
      text(60, 440, '后来新增的消息', 16);
      line(271, 411, 337, 465, 'muted');
      line(271, 465, 337, 411, 'muted');
      text(369, 442, '重新预览才更新', 16, 'muted');
      ellipse(702, 497, 42, 42, 'yellow', 'warn');
      line(712, 518, 734, 518, 'warn');
      text(757, 507, '撤销后停止访问', 16, 'warn');
      path(
        [
          [801, 493],
          [801, 399],
        ],
        'warn',
        true,
        true,
      );
      text(41, 544, '普通文件附件不公开', 15, 'muted');
    },
  },
];

mkdirSync(output, { recursive: true });
for (const spec of specs) {
  for (const theme of ['light', 'dark']) {
    const d = drawing(spec.id, theme);
    spec.draw(d);
    const scene = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: d.elements,
      appState: { viewBackgroundColor: d.p.paper, theme, gridSize: null },
      files: {},
    };
    writeFileSync(
      `${output}${spec.id}.${theme}.excalidraw.json`,
      `${JSON.stringify(scene, null, 2)}\n`,
    );
  }
}
const metadata = Object.fromEntries(
  specs.map(({ id, width, height, title, alt }) => [id, { width, height, title, alt }]),
);
writeFileSync(`${output}metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`);
process.stdout.write(`Generated ${specs.length} Excalidraw diagrams in light and dark themes.\n`);
