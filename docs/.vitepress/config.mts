import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// The site renders the repository's own /docs folder — the same Markdown that
// GitHub shows — so there is a single source of truth.
const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..');

/** Sidebar label = the page's first `# ` heading, so titles never drift. */
function item(slug: string) {
  const file = join(docsDir, `${slug}.md`);
  const heading = existsSync(file)
    ? readFileSync(file, 'utf-8').match(/^#\s+(.+)$/m)?.[1]
    : undefined;
  return { text: (heading ?? slug).replace(/`/g, ''), link: `/${slug}` };
}
const group = (text: string, slugs: string[], collapsed = false) => ({
  text,
  collapsed,
  items: slugs.map(item),
});

const base = process.env.DOCS_BASE ?? '/';
const REPO = 'https://github.com/viantonugroho11/Anvio';

/**
 * Docs link to repository files outside /docs (README, CHANGELOG, source).
 * They work on GitHub; on the site they would 404, so point them at GitHub.
 */
function repoLinks(md: any) {
  md.core.ruler.push('anvio-repo-links', (state: any) => {
    const from: string = state.env?.relativePath ?? '';
    for (const block of state.tokens) {
      for (const tok of block.children ?? []) {
        if (tok.type !== 'link_open') continue;
        const href: string = tok.attrGet('href') ?? '';
        if (!href || /^[a-z]+:|^#|^\//i.test(href)) continue;
        const [path, hash] = href.split('#');
        const target = posix.normalize(posix.join('docs', posix.dirname(from), path));
        if (target.startsWith('docs/') && !target.startsWith('docs/_detached')) continue;
        if (target.startsWith('..')) continue;
        const kind = /\.[a-z0-9]+$/i.test(target) || target.endsWith('.md') ? 'blob' : 'tree';
        tok.attrSet('href', `${REPO}/${kind}/main/${target}${hash ? `#${hash}` : ''}`);
      }
    }
  });
}

const config = withMermaid(
  defineConfig({
    title: 'Anvio',
    description: 'Extensible AI agent platform — agents in Markdown, infra in YAML.',
    base,
    // Historical, non-authoritative material and internal audit notes stay out of the site.
    srcExclude: [
      '_detached/**',
      'audit/**',
      'audits/**',
      'plans/**',
      'documentation-maintenance-report.md',
    ],
    // Links that legitimately leave the site (repo files, excluded folders).
    // Links into folders kept off the site (see srcExclude) and local dev URLs.
    ignoreDeadLinks: [
      /\/(audit|audits|plans)\//,
      /documentation-maintenance-report/,
      /^https?:\/\/(localhost|127\.0\.0\.1)/,
    ],
    cleanUrls: true,
    lastUpdated: true,
    head: [['link', { rel: 'icon', href: `${base}logo.svg` }]],
    markdown: { config: repoLinks },
    rewrites: { 'README.md': 'docs-index.md' },
    themeConfig: {
      logo: '/logo.svg',
      search: { provider: 'local' },
      nav: [
        { text: 'Get started', link: '/getting-started' },
        { text: 'Architecture', link: '/02-architecture' },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Environment variables', link: '/reference/environment-variables' },
            { text: 'Built-in tools', link: '/reference/builtin-tools' },
            { text: 'MCP', link: '/reference/mcp' },
            { text: 'HTTP API', link: '/15-api-reference' },
            { text: 'Project metrics', link: '/reference/project-metrics' },
          ],
        },
        { text: 'ADRs', link: '/adr/README' },
        { text: 'Roadmap', link: '/ROADMAP' },
      ],
      sidebar: [
        {
          text: 'Start here',
          items: [item('getting-started'), { text: 'Documentation index', link: '/docs-index' }],
        },
        group('Architecture', [
          '02-architecture',
          '03-runtime',
          '24-advanced-agent-os-overview',
          '35-workspace-architecture',
          '38-integration-architecture',
          '17-event-flows',
          '18-sequence-diagrams',
        ]),
        group(
          'Agents & orchestration',
          [
            '04-personas',
            '25-soul-system',
            '42-soul-gate',
            '40-subagent-delegation',
            '30-runtime-providers',
            '47-remote-runtimes',
            '26-goal-system',
            '28-kanban-system',
            '32-batch-processing',
            '27-automation-engine',
            '31-event-hooks',
            '11-workflows',
            '45-workflow-engine',
            '34-blueprint-catalog',
          ],
          true,
        ),
        group('Protocols', ['78-a2a-protocol', '39-editor-integration'], true),
        group(
          'Tools & MCP',
          [
            '44-tool-gateway',
            '08-tools',
            '07-mcp',
            '71-mcp-setup-guide',
            'reference/builtin-tools',
            'reference/mcp',
          ],
          true,
        ),
        group('Models', ['09-model-router', '36-provider-routing', '33-credential-pools'], true),
        group(
          'Skills',
          [
            '05-skills',
            '37-skills-catalog',
            '77-skill-execution-engine',
            '74-workflow-to-skill-example',
          ],
          true,
        ),
        group(
          'Memory & learning',
          ['06-memory', '29-memory-providers', '43-learning-loop', '49-workspace-artifacts'],
          true,
        ),
        group(
          'Channels & voice',
          [
            '10-channels',
            '41-channel-harness',
            '46-expanded-channels',
            '76-unified-gateway',
            '48-voice-mode',
          ],
          true,
        ),
        group(
          'Operations',
          [
            '12-security',
            '13-observability',
            '72-observability-langfuse',
            '14-deployment',
            '19-runbooks',
            '20-troubleshooting',
            '16-database-schema',
          ],
          true,
        ),
        group('Reference', [
          'reference/cli',
          'reference/environment-variables',
          '15-api-reference',
          'reference/project-metrics',
        ]),
        group('Contributing', ['21-development-guide', '22-contributing', 'ROADMAP']),
      ],
      editLink: {
        pattern: 'https://github.com/viantonugroho11/Anvio/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
      socialLinks: [{ icon: 'github', link: 'https://github.com/viantonugroho11/Anvio' }],
      footer: {
        message:
          'Released under the MIT License. When docs and code disagree, the code is the source of truth.',
        copyright: '© 2026 Muhammad Novianto Nugroho',
      },
      outline: { level: [2, 3] },
    },
    mermaid: {},
  }),
);

// mermaid ships syntax esbuild cannot down-level to VitePress' default browser
// target. Patch *after* withMermaid so its own vite settings (aliases) survive.
config.vite ??= {};
config.vite.build = { ...config.vite.build, target: 'esnext' };
// vitepress-plugin-mermaid pre-bundles mermaid's CommonJS deps by bare name;
// pnpm does not hoist them, so address them through mermaid instead.
const MERMAID_DEPS = ['@braintree/sanitize-url', 'dayjs', 'debug', 'cytoscape', 'cytoscape-cose-bilkent'];
config.vite.optimizeDeps = {
  ...config.vite.optimizeDeps,
  include: (config.vite.optimizeDeps?.include ?? []).map((dep: string) =>
    MERMAID_DEPS.includes(dep) ? `mermaid > ${dep}` : dep,
  ),
  esbuildOptions: { ...config.vite.optimizeDeps?.esbuildOptions, target: 'esnext' },
};

export default config;
