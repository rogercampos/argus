// Temporary verification helper: find a tree row by name (through shadow DOM),
// click it, then screenshot
import { writeFileSync } from 'node:fs'

const [, , port = '9222', name = 'AGENTS.md', outPath = '/tmp/argus-open-file.png'] = process.argv

const targets = await (await fetch(`http://localhost:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

function send(method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMessage)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

// Focus the tree's search box and type the name so virtualization mounts the row
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: 140, y: 91, button: 'left', clickCount: 1 })
}
await send('Input.insertText', { text: name })
await new Promise((r) => setTimeout(r, 1500))

const findRowExpression = `
(() => {
  const host = document.querySelector('file-tree-container')
  if (!host || !host.shadowRoot) return null
  for (const el of host.shadowRoot.querySelectorAll('[role=treeitem]')) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && (el.textContent || '').includes(${JSON.stringify(name.slice(0, 7))})) {
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
    }
  }
  return null
})()
`

const found = await send('Runtime.evaluate', { expression: findRowExpression, returnByValue: true })
if (!found.result.value) throw new Error(`Row not found: ${name}`)
const { x, y } = JSON.parse(found.result.value)
console.log(`Found ${name} at (${x.toFixed(0)}, ${y.toFixed(0)})`)

for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}
await new Promise((r) => setTimeout(r, 2000))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log('Screenshot saved to', outPath)
ws.close()
