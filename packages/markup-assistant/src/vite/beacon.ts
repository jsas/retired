/**
 * The beacon: injected into every page. Joins the SSE bus, submits intents,
 * and renders the on-page HUD so the input side always knows where its
 * markup stands: received -> accepted -> processing -> applied/failed.
 */
import { isTerminalStatus, type Envelope, type Status } from '../core/index.js'

const PREFIX = '/__markup_assistant__'

const STATE_STYLE: Record<string, { bg: string }> = {
  received: { bg: '#3a3a3c' },
  accepted: { bg: '#0a84ff' },
  processing: { bg: '#ff9f0a' },
  applied: { bg: '#30d158' },
  failed: { bg: '#ff453a' },
  rejected: { bg: '#bf5af2' },
  cancelled: { bg: '#8e8e93' },
}

export function mountBeacon(): { destroy(): void } {
  const root = document.createElement('div')
  root.style.cssText =
    'position:fixed;bottom:12px;left:12px;z-index:2147483700;display:none;' +
    'align-items:center;gap:8px;background:#1c1c1e;color:#fff;border-radius:999px;' +
    'padding:6px 14px;font:12px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.4);'
  const dot = document.createElement('span')
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#3a3a3c;'
  const label = document.createElement('span')
  const detail = document.createElement('span')
  detail.style.cssText = 'opacity:.6;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  root.append(dot, label, detail)
  document.body.appendChild(root)

  const es = new EventSource(`${PREFIX}/events`)
  es.onmessage = (ev) => {
    const envelope = JSON.parse(ev.data) as Envelope
    if (envelope.kind !== 'status') return
    const status = envelope.payload as Status
    showStatus(root, dot, label, detail, status)
  }

  return {
    destroy() {
      es.close()
      root.remove()
    },
  }
}

function showStatus(
  root: HTMLElement,
  dot: HTMLElement,
  label: HTMLElement,
  detail: HTMLElement,
  status: Status,
) {
  const style = STATE_STYLE[status.state] ?? { bg: '#3a3a3c' }
  root.style.display = 'flex'
  label.textContent = status.state
  detail.textContent = status.detail
  dot.style.background = style.bg ?? '#3a3a3c'
  if (isTerminalStatus(status.state)) {
    window.setTimeout(() => {
      root.style.display = 'none'
    }, 4000)
  }
}

if (typeof window !== 'undefined' && document.currentScript) {
  mountBeacon()
}
