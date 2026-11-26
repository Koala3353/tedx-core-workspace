import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vite'
import { readClientEnvironment } from './src/lib/env.ts'

// Vercel injects this even when system env exposure is disabled. Keep its
// observability metadata out of the browser bundle and the app configuration.
delete process.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG

export default defineConfig(({ command, mode }) => {
  const values = loadEnv(mode, process.cwd(), 'VITE_')
  const input = {
    VITE_SUPABASE_URL: values.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: values.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_APP_ORIGIN: values.VITE_APP_ORIGIN,
    VITE_DRIVE_PICKER_ENABLED: values.VITE_DRIVE_PICKER_ENABLED,
    VITE_DRIVE_EVIDENCE_ENABLED: values.VITE_DRIVE_EVIDENCE_ENABLED,
    VITE_CALENDAR_SYNC_ENABLED: values.VITE_CALENDAR_SYNC_ENABLED,
    VITE_TELEGRAM_BOT_USERNAME: values.VITE_TELEGRAM_BOT_USERNAME,
    VITE_EMAIL_DIGEST_ENABLED: values.VITE_EMAIL_DIGEST_ENABLED,
  }
  const hasSettings = !!(input.VITE_SUPABASE_URL?.trim() || input.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
    || input.VITE_APP_ORIGIN?.trim() || input.VITE_TELEGRAM_BOT_USERNAME?.trim()
    || [input.VITE_DRIVE_PICKER_ENABLED,input.VITE_DRIVE_EVIDENCE_ENABLED,input.VITE_CALENDAR_SYNC_ENABLED,input.VITE_EMAIL_DIGEST_ENABLED]
      .some(setting=>setting?.trim() && setting.trim()!=='false'))
  const environment = readClientEnvironment(input)
  // Deployment base path. GitHub Pages project sites serve from /<repository>/; a custom
  // domain or Vercel serves from /. Not a VITE_ setting, so it never enters the bundle as config.
  const base = (process.env.PAGES_BASE_PATH ?? '/').trim() || '/'
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base)) {
    throw new Error('PAGES_BASE_PATH must start and end with "/", for example /TEDxAteneo2627/.')
  }
  // Client-side rejection is too late: VITE_ values can already be in the bundle.
  if (command === 'build') {
    const unexpectedSettings = Object.keys(values).filter(key => !Object.hasOwn(input,key))
    if (unexpectedSettings.length) {
      throw new Error(`Unexpected VITE_ setting names: ${unexpectedSettings.sort().join(', ')}. Only documented public settings are allowed in a build.`)
    }
    if (hasSettings && environment.state !== 'configured') {
      throw new Error('Invalid public configuration. Supply the documented origins and publishable key, or leave the settings blank.')
    }
    if (mode === 'pages' && (environment.state !== 'configured' || !environment.appOrigin)) {
      throw new Error('A Pages build requires the exact HTTPS frontend origin and its Supabase project settings.')
    }
  }

  const offlineDocument = readFileSync(new URL('./public/offline/index.html', import.meta.url), 'utf8')
  const offlineStyle = offlineDocument.match(/<style>([\s\S]*?)<\/style>/)?.[1]?.replace(/\r\n?/g, '\n')
  if (!offlineStyle) throw new Error('The offline document must include its standalone stylesheet.')
  const offlineHash = createHash('sha256').update(offlineStyle).digest('base64')
  const apiOrigin = environment.state === 'configured' ? ` ${environment.supabaseUrl}` : ''
  const picker = environment.state==='configured' && environment.drivePicker
  const headers = {
    'Content-Security-Policy': [
      "default-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
      picker ? "script-src 'self' https://apis.google.com" : "script-src 'self'",
      ...(picker ? ["frame-src https://docs.google.com https://drive.google.com"] : []),
      `style-src 'self' 'sha256-${offlineHash}'`, "img-src 'self' blob:",
      "font-src 'self'", `connect-src 'self'${apiOrigin}`, "manifest-src 'self'", "worker-src 'self'",
    ].join('; '),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }

  // GitHub Pages ignores _headers, so the Pages build carries the policy in a <meta> tag.
  // frame-ancestors is not honoured in <meta>; src/main.tsx refuses to render when framed.
  const metaPolicy = headers['Content-Security-Policy'].split('; ')
    .filter(directive => !directive.startsWith('frame-ancestors')).join('; ')
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${metaPolicy}" />`
  const injectPolicy = (html: string) => html.replace(/<meta charset="utf-8"\s*\/?>/i, match => `${match}\n    ${metaTag}`)
  let outDir = 'dist'

  return {
    base,
    plugins: [react(), {
      name: 'workspace-host-headers',
      apply: 'build',
      generateBundle() {
        if (mode === 'pages') return
        const source = '/*\n' + Object.entries(headers).map(([name,value]) => `  ${name}: ${value}\n`).join('')
        this.emitFile({ type: 'asset', fileName: '_headers', source })
      },
    }, {
      // Every visit starts by reading the Supabase session, and the client loads through a
      // dynamic import. Preload its chunk so it downloads alongside the entry, not after it.
      name: 'workspace-preload',
      apply: 'build',
      transformIndexHtml: { order: 'post', handler(html, context) {
        const files = Object.values(context.bundle ?? {})
        const chunk = files.find(file => file.type === 'chunk' && file.name === 'supabase-vendor')
        // The latin faces of the body (Karla) and heading (Inter) fonts are used on every first
        // paint; preloading them skips the stylesheet-then-font round trip. Same origin, so the
        // font-src 'self' policy still applies.
        const fonts = files.filter(file => file.type === 'asset' && /^assets\/(?:inter|karla)-latin-wght-normal-[\w-]+\.woff2$/.test(file.fileName))
        return { html, tags: [
          ...(chunk ? [{ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: base + chunk.fileName }, injectTo: 'head' as const }] : []),
          ...fonts.map(font => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: base + font.fileName }, injectTo: 'head' as const })),
        ] }
      } },
    }, {
      name: 'workspace-github-pages',
      apply: 'build',
      configResolved(config) { outDir = config.build.outDir },
      transformIndexHtml(html) {
        if (mode !== 'pages') return html
        const result = injectPolicy(html)
        if (result === html) throw new Error('index.html needs <meta charset="UTF-8"> for the Pages policy.')
        return result
      },
      closeBundle() {
        if (mode !== 'pages') return
        const offline = join(outDir, 'offline', 'index.html')
        const offlineHtml = readFileSync(offline, 'utf8'), offlineResult = injectPolicy(offlineHtml)
        if (offlineResult === offlineHtml) throw new Error('offline/index.html needs <meta charset="utf-8"> for the Pages policy.')
        writeFileSync(offline, offlineResult)
        // Pages has no rewrites: serve the app shell for deep links such as /tasks/<id>.
        copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'))
        writeFileSync(join(outDir, '.nojekyll'), '')
      },
    }],
    build: {
      rolldownOptions: {
        output: {
          // Stable vendor chunks: an app deploy changes only app chunk hashes, so returning
          // visitors keep React and Supabase from the browser and service worker caches.
          codeSplitting: {
            groups: [
              { name: 'react-vendor', test: /node_modules[\\/](?:react|react-dom|react-router|scheduler|cookie|set-cookie-parser)[\\/]/, priority: 3 },
              { name: 'supabase-vendor', test: /node_modules[\\/](?:@supabase[\\/]|tslib[\\/]|iceberg-js[\\/])/, priority: 2 },
            ],
          },
        },
      },
    },
    preview: { headers },
  }
})
