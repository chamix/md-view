import { describe, it, expect, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  MERMAID_MAX_TEXT_SIZE,
  mermaidConfig,
  diagramThemeFor,
  exceedsMaxTextSize,
  createGenerationGate,
  createDiagramController,
  createMermaidEngine,
} = require('../../src/renderer/diagrams.js');

// Task 45 (functional_domain.md #158, #162-#165; initial_scaffold.md Task 45
// Step 1 "Diagram pass: generation design"). Pure Node, no jsdom: the
// controller is driven through fake engine/view ports only.

const MERMAID_DEFAULT_SECURE = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges'];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface RenderCall {
  id: string;
  source: string;
  theme: string;
  d: Deferred<string>;
}

// Fake engine port: every ready()/render() is a controllable deferred.
function fakeEngine(opts: { readyNow?: boolean } = {}) {
  const readyCalls: Deferred<void>[] = [];
  const renders: RenderCall[] = [];
  const engine = {
    ready: vi.fn(() => {
      const d = deferred<void>();
      readyCalls.push(d);
      if (opts.readyNow !== false) d.resolve();
      return d.promise;
    }),
    render: vi.fn((id: string, source: string, theme: string) => {
      const d = deferred<string>();
      renders.push({ id, source, theme, d });
      return d.promise;
    }),
  };
  return { engine, readyCalls, renders };
}

interface Write {
  slot: number;
  kind: 'svg' | 'failure';
  value: string;
}

// Fake view port. `dom` is the slot's "DOM": showSvg replaces it, so a
// re-render that re-read the DOM instead of the captured source would see
// the SVG, not the original source.
function fakeView(sources: string[]) {
  const writes: Write[] = [];
  const dom = [...sources];
  const view = {
    collectSlots: vi.fn(() =>
      sources.map((source, i) => ({
        source,
        showSvg: (svg: string) => {
          dom[i] = svg;
          writes.push({ slot: i, kind: 'svg', value: svg });
        },
        showFailure: (message: string) => writes.push({ slot: i, kind: 'failure', value: message }),
      }))
    ),
  };
  return { view, writes, dom };
}

// Settles every pending render in order, flushing microtasks after each.
async function resolveAll(renders: RenderCall[], from = 0) {
  for (let i = from; i < renders.length; i++) {
    renders[i].d.resolve(`<svg id="${renders[i].id}">${renders[i].theme}</svg>`);
    await flush();
  }
}

describe('Task 45 #158: mermaidConfig is locked', () => {
  it('pins securityLevel strict, startOnLoad false, suppressErrorRendering true, maxTextSize, theme', () => {
    const config = mermaidConfig('dark');
    expect(config.securityLevel).toBe('strict');
    expect(config.startOnLoad).toBe(false);
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.maxTextSize).toBe(50000);
    expect(config.theme).toBe('dark');
    expect(mermaidConfig('default').theme).toBe('default');
  });

  it('maxTextSize reads the one shared MERMAID_MAX_TEXT_SIZE constant (#162 amended)', () => {
    expect(MERMAID_MAX_TEXT_SIZE).toBe(50000);
    expect(mermaidConfig('default').maxTextSize).toBe(MERMAID_MAX_TEXT_SIZE);
  });

  it('secure keeps Mermaid defaults and adds the CVE-2026-41159 keys plus theme/darkMode (D2)', () => {
    const secure: string[] = mermaidConfig('default').secure;
    const required = [
      ...MERMAID_DEFAULT_SECURE,
      'themeCSS',
      'themeVariables',
      'fontFamily',
      'altFontFamily',
      'theme',
      'darkMode',
    ];
    for (const key of required) expect(secure).toContain(key);
  });

  it('returns a fresh object (and fresh secure array) on each call', () => {
    const a = mermaidConfig('default');
    const b = mermaidConfig('default');
    expect(a).not.toBe(b);
    expect(a.secure).not.toBe(b.secure);
    a.secure.length = 0;
    a.securityLevel = 'loose';
    expect(mermaidConfig('default').securityLevel).toBe('strict');
    expect(mermaidConfig('default').secure.length).toBe(12);
  });
});

describe('Task 45 #164: diagramThemeFor', () => {
  it('dark mode -> dark, light -> default', () => {
    expect(diagramThemeFor(true)).toBe('dark');
    expect(diagramThemeFor(false)).toBe('default');
  });
});

describe('Task 45 D4: exceedsMaxTextSize', () => {
  it('is false at exactly the limit and true one past it', () => {
    expect(exceedsMaxTextSize('x'.repeat(MERMAID_MAX_TEXT_SIZE))).toBe(false);
    expect(exceedsMaxTextSize('x'.repeat(MERMAID_MAX_TEXT_SIZE + 1))).toBe(true);
    expect(exceedsMaxTextSize('')).toBe(false);
  });
});

describe('Task 45 #163: generation gate', () => {
  it('advance is monotonic and only the latest token is current', () => {
    const gate = createGenerationGate();
    const t1 = gate.advance();
    const t2 = gate.advance();
    const t3 = gate.advance();
    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
    expect(gate.isCurrent(t1)).toBe(false);
    expect(gate.isCurrent(t2)).toBe(false);
    expect(gate.isCurrent(t3)).toBe(true);
  });
});

describe('Task 45: diagram controller', () => {
  it('N slots produce N render calls with unique ids, and showSvg for each (#165)', async () => {
    const { engine, renders } = fakeEngine();
    const { view, writes } = fakeView(['graph A', 'graph B', 'graph C']);
    const controller = createDiagramController({ engine, view });

    const pass = controller.documentRendered();
    await flush();
    expect(renders).toHaveLength(1); // sequential: one render at a time
    await resolveAll(renders);
    await pass;

    expect(renders.map((r) => r.source)).toEqual(['graph A', 'graph B', 'graph C']);
    const ids = renders.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id, i) => expect(id).toMatch(new RegExp(`^mdv-diagram-\\d+-${i}$`)));
    expect(writes.map((w) => [w.slot, w.kind])).toEqual([
      [0, 'svg'],
      [1, 'svg'],
      [2, 'svg'],
    ]);
    expect(renders.every((r) => r.theme === 'default')).toBe(true);
  });

  it('a rejecting slot shows its failure and the other slots still render (#162)', async () => {
    const { engine, renders } = fakeEngine();
    const { view, writes } = fakeView(['ok 1', 'broken', 'ok 2']);
    const controller = createDiagramController({ engine, view });

    const pass = controller.documentRendered();
    await flush();
    renders[0].d.resolve('<svg/>');
    await flush();
    renders[1].d.reject(new Error('Parse error on line 1'));
    await flush();
    renders[2].d.resolve('<svg/>');
    await expect(pass).resolves.toBeUndefined();

    expect(writes.map((w) => w.kind)).toEqual(['svg', 'failure', 'svg']);
    expect(writes[1].value).toContain('Parse error on line 1');
  });

  it('a non-Error rejection still yields a string failure message', async () => {
    const { engine, renders } = fakeEngine();
    const { view, writes } = fakeView(['broken']);
    const controller = createDiagramController({ engine, view });
    const pass = controller.documentRendered();
    await flush();
    renders[0].d.reject('plain string reason');
    await pass;
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe('failure');
    expect(writes[0].value).toContain('plain string reason');
  });

  it('an oversized slot shows the failure without calling engine.render (D4)', async () => {
    const { engine, renders } = fakeEngine();
    const big = 'x'.repeat(MERMAID_MAX_TEXT_SIZE + 1);
    const { view, writes } = fakeView(['ok', big]);
    const controller = createDiagramController({ engine, view });

    const pass = controller.documentRendered();
    await flush();
    await resolveAll(renders);
    await pass;

    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(renders[0].source).toBe('ok');
    expect(writes.map((w) => [w.slot, w.kind])).toEqual([
      [0, 'svg'],
      [1, 'failure'],
    ]);
    expect(writes[1].value).toMatch(/too large/i);
  });

  it('a slot at exactly the limit is rendered, not rejected', async () => {
    const { engine, renders } = fakeEngine();
    const { view } = fakeView(['x'.repeat(MERMAID_MAX_TEXT_SIZE)]);
    const controller = createDiagramController({ engine, view });
    const pass = controller.documentRendered();
    await flush();
    await resolveAll(renders);
    await pass;
    expect(engine.render).toHaveBeenCalledTimes(1);
  });

  it('D1: zero slots means the engine is never touched (no bundle load)', async () => {
    const { engine } = fakeEngine();
    const { view } = fakeView([]);
    const controller = createDiagramController({ engine, view });
    await controller.documentRendered();
    await controller.darkModeChanged(true);
    expect(engine.ready).not.toHaveBeenCalled();
    expect(engine.render).not.toHaveBeenCalled();
  });

  describe('#163 no stale writes', () => {
    it('documentCleared() while a render is pending gives zero writes after resolution', async () => {
      const { engine, renders } = fakeEngine();
      const { view, writes } = fakeView(['a', 'b']);
      const controller = createDiagramController({ engine, view });

      const pass = controller.documentRendered();
      await flush();
      expect(renders).toHaveLength(1);
      controller.documentCleared();
      renders[0].d.resolve('<svg/>');
      await pass;

      expect(writes).toEqual([]);
      expect(renders).toHaveLength(1); // the loop stopped, no render for slot 1
    });

    it('documentCleared() while a render is pending: a rejection writes nothing either', async () => {
      const { engine, renders } = fakeEngine();
      const { view, writes } = fakeView(['a']);
      const controller = createDiagramController({ engine, view });
      const pass = controller.documentRendered();
      await flush();
      controller.documentCleared();
      renders[0].d.reject(new Error('late failure'));
      await pass;
      expect(writes).toEqual([]);
    });

    it('documentRendered() with new slots while old renders are pending writes only the new slots', async () => {
      const { engine, renders } = fakeEngine();
      const oldView = fakeView(['old 1', 'old 2']);
      const newView = fakeView(['new 1']);
      let current = oldView;
      const view = { collectSlots: () => current.view.collectSlots() };
      const controller = createDiagramController({ engine, view });

      const oldPass = controller.documentRendered();
      await flush();
      current = newView;
      const newPass = controller.documentRendered();
      await flush();
      await resolveAll(renders);
      await Promise.all([oldPass, newPass]);

      expect(oldView.writes).toEqual([]);
      expect(newView.writes.map((w) => w.kind)).toEqual(['svg']);
      expect(renders.map((r) => r.source)).toEqual(['old 1', 'new 1']);
    });

    it('darkModeChanged(!dark) mid-pass writes nothing from the old pass; the new pass uses the new theme', async () => {
      const { engine, renders } = fakeEngine();
      const { view, writes } = fakeView(['a', 'b']);
      const controller = createDiagramController({ engine, view });

      const oldPass = controller.documentRendered();
      await flush();
      expect(renders[0].theme).toBe('default');
      const newPass = controller.darkModeChanged(true);
      await flush();
      await resolveAll(renders);
      await Promise.all([oldPass, newPass]);

      const oldIds = new Set([renders[0].id]);
      expect(writes.some((w) => oldIds.has(w.value.match(/id="([^"]+)"/)?.[1] ?? ''))).toBe(false);
      expect(writes.every((w) => w.value.includes('dark'))).toBe(true);
      expect(writes.map((w) => w.slot)).toEqual([0, 1]);
      expect(renders.slice(1).every((r) => r.theme === 'dark')).toBe(true);
    });
  });

  describe('#163 (amended): the bundle load respects generations', () => {
    it('ready() pending, documentCleared(), ready() resolves: zero writes and zero renders from the old pass', async () => {
      const { engine, readyCalls } = fakeEngine({ readyNow: false });
      const { view, writes } = fakeView(['a', 'b']);
      const controller = createDiagramController({ engine, view });

      const pass = controller.documentRendered();
      await flush();
      controller.documentCleared();
      readyCalls[0].resolve();
      await pass;

      expect(engine.render).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('ready() pending, documentCleared(), ready() REJECTS: no showFailure from the old pass', async () => {
      const { engine, readyCalls } = fakeEngine({ readyNow: false });
      const { view, writes } = fakeView(['a', 'b']);
      const controller = createDiagramController({ engine, view });

      const pass = controller.documentRendered();
      await flush();
      controller.documentCleared();
      readyCalls[0].reject(new Error('load failed'));
      await expect(pass).resolves.toBeUndefined();

      expect(engine.render).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    });

    it('ready() pending, newer documentRendered(), old load settles: only the new document is written', async () => {
      const { engine, readyCalls, renders } = fakeEngine({ readyNow: false });
      const oldView = fakeView(['old']);
      const newView = fakeView(['new']);
      let current = oldView;
      const view = { collectSlots: () => current.view.collectSlots() };
      const controller = createDiagramController({ engine, view });

      const oldPass = controller.documentRendered();
      await flush();
      current = newView;
      const newPass = controller.documentRendered();
      await flush();
      readyCalls.forEach((d) => d.resolve());
      await flush();
      await resolveAll(renders);
      await Promise.all([oldPass, newPass]);

      expect(renders.map((r) => r.source)).toEqual(['new']);
      expect(oldView.writes).toEqual([]);
      expect(newView.writes.map((w) => w.kind)).toEqual(['svg']);
    });

    it('ready() pending, newer documentRendered(), old load REJECTS: no failure written to the old slots', async () => {
      const { engine, readyCalls } = fakeEngine({ readyNow: false });
      const oldView = fakeView(['old']);
      const newView = fakeView(['new']);
      let current = oldView;
      const view = { collectSlots: () => current.view.collectSlots() };
      const controller = createDiagramController({ engine, view });

      const oldPass = controller.documentRendered();
      await flush();
      current = newView;
      const newPass = controller.documentRendered();
      readyCalls[0].reject(new Error('load failed'));
      readyCalls[1].reject(new Error('load failed'));
      await Promise.all([oldPass, newPass]);

      expect(oldView.writes).toEqual([]);
      expect(newView.writes.map((w) => w.kind)).toEqual(['failure']);
    });
  });

  it('#162 (amended): ready() rejecting on a current pass shows showFailure on every slot, never throws', async () => {
    const { engine, readyCalls } = fakeEngine({ readyNow: false });
    const { view, writes } = fakeView(['a', 'b', 'c']);
    const controller = createDiagramController({ engine, view });

    const pass = controller.documentRendered();
    readyCalls[0].reject(new Error('Failed to load mermaid.min.js'));
    await expect(pass).resolves.toBeUndefined();

    expect(engine.render).not.toHaveBeenCalled();
    expect(writes.map((w) => [w.slot, w.kind])).toEqual([
      [0, 'failure'],
      [1, 'failure'],
      [2, 'failure'],
    ]);
  });

  describe('#164 theme follows dark mode', () => {
    it('darkModeChanged(sameValue) produces zero render calls', async () => {
      const { engine, renders } = fakeEngine();
      const { view } = fakeView(['a']);
      const controller = createDiagramController({ engine, view });
      const pass = controller.documentRendered();
      await flush();
      await resolveAll(renders);
      await pass;
      expect(engine.render).toHaveBeenCalledTimes(1);

      // Assert synchronously before awaiting: under a broken no-op the fake
      // render never resolves, and awaiting first would time out opaquely.
      const same1 = controller.darkModeChanged(false); // initial state is light
      const same2 = controller.darkModeChanged(false);
      await flush();
      expect(engine.render).toHaveBeenCalledTimes(1);
      expect(engine.ready).toHaveBeenCalledTimes(1);
      await Promise.all([same1, same2]);
    });

    it('a theme change re-renders from the source captured at collection, without re-collecting', async () => {
      const { engine, renders } = fakeEngine();
      const { view, dom } = fakeView(['graph TD; A-->B', 'graph TD; C-->D']);
      const controller = createDiagramController({ engine, view });

      const pass = controller.documentRendered();
      await flush();
      await resolveAll(renders);
      await pass;
      // The "DOM" now holds SVGs, not sources.
      expect(dom.every((d) => d.startsWith('<svg'))).toBe(true);

      const themePass = controller.darkModeChanged(true);
      await flush();
      await resolveAll(renders, 2);
      await themePass;

      expect(view.collectSlots).toHaveBeenCalledTimes(1);
      expect(renders.slice(2).map((r) => [r.source, r.theme])).toEqual([
        ['graph TD; A-->B', 'dark'],
        ['graph TD; C-->D', 'dark'],
      ]);
      // Unique ids across passes (#165).
      expect(new Set(renders.map((r) => r.id)).size).toBe(4);
    });

    it('darkModeChanged before any document just records the value; the next pass uses it', async () => {
      const { engine, renders } = fakeEngine();
      const { view } = fakeView(['a']);
      const controller = createDiagramController({ engine, view });
      await controller.darkModeChanged(true);
      expect(engine.ready).not.toHaveBeenCalled();

      const pass = controller.documentRendered();
      await flush();
      await resolveAll(renders);
      await pass;
      expect(renders[0].theme).toBe('dark');
    });

    it('after documentCleared, a theme change renders nothing (slots were dropped)', async () => {
      const { engine, renders } = fakeEngine();
      const { view } = fakeView(['a']);
      const controller = createDiagramController({ engine, view });
      const pass = controller.documentRendered();
      await flush();
      await resolveAll(renders);
      await pass;
      controller.documentCleared();
      await controller.darkModeChanged(true);
      expect(engine.render).toHaveBeenCalledTimes(1);
    });
  });

  it('#165: a second documentRendered() re-collects and re-renders', async () => {
    const { engine, renders } = fakeEngine();
    const { view, writes } = fakeView(['a']);
    const controller = createDiagramController({ engine, view });

    const p1 = controller.documentRendered();
    await flush();
    await resolveAll(renders);
    await p1;
    const p2 = controller.documentRendered();
    await flush();
    await resolveAll(renders, 1);
    await p2;

    expect(view.collectSlots).toHaveBeenCalledTimes(2);
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(renders[0].id).not.toBe(renders[1].id);
    expect(writes).toHaveLength(2);
  });
});

describe('Task 45 D1: Mermaid engine adapter', () => {
  function fakeMermaid() {
    const calls: string[] = [];
    const configs: unknown[] = [];
    const mermaid = {
      initialize: vi.fn((config: unknown) => {
        calls.push('initialize');
        configs.push(config);
      }),
      render: vi.fn(async (id: string, source: string) => {
        calls.push(`render:${id}`);
        return { svg: `<svg id="${id}">${source}</svg>`, bindFunctions: bindFunctions };
      }),
    };
    const bindFunctions = vi.fn();
    return { mermaid, calls, configs, bindFunctions };
  }

  it('appends exactly one script across many renders, with scriptUrl exactly as given', async () => {
    const fake = fakeMermaid();
    const appendScript = vi.fn(async () => undefined);
    const scriptUrl = 'file:///C:/app/dist/renderer/mermaid.min.js';
    const engine = createMermaidEngine({ scriptUrl, appendScript, getGlobal: () => fake.mermaid });

    await engine.ready();
    await engine.render('mdv-diagram-1-0', 'graph A', 'default');
    await engine.render('mdv-diagram-1-1', 'graph B', 'dark');
    await engine.ready();

    expect(appendScript).toHaveBeenCalledTimes(1);
    expect(appendScript).toHaveBeenCalledWith(scriptUrl);
  });

  it('render() without a prior ready() still loads first (memoized), then renders', async () => {
    const fake = fakeMermaid();
    const appendScript = vi.fn(async () => undefined);
    const engine = createMermaidEngine({ scriptUrl: 'u', appendScript, getGlobal: () => fake.mermaid });
    const svg = await engine.render('id-1', 'graph X', 'default');
    expect(svg).toBe('<svg id="id-1">graph X</svg>');
    expect(appendScript).toHaveBeenCalledTimes(1);
  });

  it('initialize receives mermaidConfig(theme) before every render; bindFunctions is never invoked', async () => {
    const fake = fakeMermaid();
    const engine = createMermaidEngine({ scriptUrl: 'u', appendScript: async () => undefined, getGlobal: () => fake.mermaid });

    await engine.render('a', 'graph A', 'default');
    await engine.render('b', 'graph B', 'dark');

    expect(fake.calls).toEqual(['initialize', 'render:a', 'initialize', 'render:b']);
    expect(fake.configs).toEqual([mermaidConfig('default'), mermaidConfig('dark')]);
    expect(fake.bindFunctions).not.toHaveBeenCalled();
  });

  it('a load failure rejects ready() and every render(), without retrying the append', async () => {
    const appendScript = vi.fn(async () => {
      throw new Error('script load error');
    });
    const engine = createMermaidEngine({ scriptUrl: 'u', appendScript, getGlobal: () => undefined });

    await expect(engine.ready()).rejects.toThrow();
    await expect(engine.render('a', 'graph A', 'default')).rejects.toThrow();
    await expect(engine.render('b', 'graph B', 'default')).rejects.toThrow();
    expect(appendScript).toHaveBeenCalledTimes(1);
  });

  it('a script that loads but defines no mermaid global rejects', async () => {
    const engine = createMermaidEngine({ scriptUrl: 'u', appendScript: async () => undefined, getGlobal: () => undefined });
    await expect(engine.ready()).rejects.toThrow(/mermaid/i);
  });
});
