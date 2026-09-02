/**
 * markupAssistant(): the dev-server bridge. Adds to any Vite app:
 *
 *  - GET  /__markup_assistant__/events  SSE stream of the engine bus
 *  - POST /__markup_assistant__/intent  browser -> engine (intent submission)
 *  - POST /__markup_assistant__/apply   apply a source edit on disk
 *  - GET  /__markup_assistant__/source?file=...  read a source file (model context)
 *
 * The overlay itself is attached by the app (any module calling attachOverlay
 * against the endpoints); this plugin only serves the bridge.
 */
import type { Plugin, ViteDevServer } from 'vite'
import { createBus, type Bus } from '../core/bus.js'
import type { Envelope } from '../core/protocol.js'
import { startSession, type Engine, type Sink } from '../engine/index.js'
import { applyTextPatch } from '../output/diff.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep, isAbsolute } from 'node:path'

export interface MarkupAssistantOptions {
  engine: Engine
  /** Root directory source edits are confined to. Default: vite root. */
  root?: string
  /** Prefix for all endpoints. */
  endpointPrefix?: string
  /**
   * Extra sinks for the session (e.g. a source sink that posts back to the
   * /apply endpoint). Dom edits aren't applied server-side.
   */
  sinks?: Sink[]
}

export function markupAssistant(options: MarkupAssistantOptions): Plugin {
  const prefix = options.endpointPrefix ?? '/__markup_assistant__'

  return {
    name: 'markup-assistant',
    configureServer(server: ViteDevServer) {
      const bus: Bus = createBus()
      const session = startSession({
        bus,
        engine: options.engine,
        sinks: options.sinks ?? [],
        source: 'vite-plugin',
      })
      server.httpServer?.once('listening', () => {
        server.config.logger.info('markup-assistant: bridge ready')
      })
      server.httpServer?.on('close', () => session.stop())

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith(prefix)) return next()

        if (req.method === 'GET' && url === `${prefix}/events`) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          const off = bus.subscribe((envelope) => {
            res.write(`data: ${JSON.stringify(envelope)}\n\n`)
          })
          req.on('close', off)
          return
        }

        if (req.method === 'POST' && url === `${prefix}/intent`) {
          let body = ''
          req.on('data', (chunk) => (body += chunk))
          req.on('end', () => {
            try {
              const envelope = JSON.parse(body) as Envelope
              bus.publish(envelope)
              res.writeHead(202).end()
            } catch {
              res.writeHead(400).end('bad json')
            }
          })
          return
        }

        if (req.method === 'POST' && url === `${prefix}/apply`) {
          let body = ''
          req.on('data', (chunk) => (body += chunk))
          req.on('end', () => {
            void handleApply(options, server.config.root, body, res)
          })
          return
        }

        if (req.method === 'GET' && url.startsWith(`${prefix}/source`)) {
          const u = new URL(url, 'http://x')
          const file = u.searchParams.get('file') ?? ''
          const full = safeResolve(options.root ?? server.config.root, file)
          if (!full) {
            res.writeHead(403).end('path outside project root')
            return
          }
          try {
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
            res.end(readFileSync(full, 'utf8'))
          } catch {
            res.writeHead(404).end('not found')
          }
          return
        }

        next()
      })
    },
  }
}

async function handleApply(
  options: MarkupAssistantOptions,
  serverRoot: string,
  body: string,
  res: import('node:http').ServerResponse,
) {
  try {
    const { edit } = JSON.parse(body) as { edit: unknown }
    if (typeof edit !== 'object' || edit === null) throw new Error('bad edit')
    const e = edit as { kind?: string; file?: unknown; find?: unknown; replace?: unknown; content?: unknown }
    if (typeof e.file !== 'string') throw new Error('edit.file required')
    const full = safeResolve(options.root ?? serverRoot, e.file)
    if (!full) {
      res.writeHead(403).end('path outside project root')
      return
    }
    if (e.kind === 'text') {
      if (typeof e.find !== 'string' || typeof e.replace !== 'string') throw new Error('text edit needs find/replace')
      const current = readFileSync(full, 'utf8')
      const result = applyTextPatch(current, e.find, e.replace)
      if (!result.ok || result.content === undefined) {
        res.writeHead(409).end(result.reason ?? 'patch failed')
        return
      }
      writeFileSyncSafe(full, result.content)
      res.writeHead(200).end('ok')
      return
    }
    if (e.kind === 'write') {
      if (typeof e.content !== 'string') throw new Error('write edit needs content')
      writeFileSyncSafe(full, e.content)
      res.writeHead(200).end('ok')
      return
    }
    res.writeHead(400).end('unsupported edit kind for disk')
  } catch (err) {
    res.writeHead(400).end(String(err))
  }
}

function writeFileSyncSafe(full: string, content: string): void {
  writeFileSync(full, content, 'utf8')
}

/** Resolve `file` under `root`, refusing escapes. Returns null when unsafe. */
export function safeResolve(root: string, file: string): string | null {
  if (!file) return null
  if (file.includes('..')) return null
  const full = isAbsolute(file) ? file : resolve(root, file)
  if (!full.startsWith(resolve(root))) return null
  if (full.includes('..') && (full.includes(`${sep}..`) || full.endsWith('..'))) return null
  return full
}
