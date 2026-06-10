// Temporary verification helper: click at coordinates, then screenshot
import { writeFileSync } from 'node:fs'

const [, , port = '9222', x = '100', y = '195', outPath = '/tmp/argus-click.png'] = process.argv

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

const px = Number(x)
const py = Number(y)
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type,
    x: px,
    y: py,
    button: 'left',
    clickCount: 1
  })
}
await new Promise((r) => setTimeout(r, 1500))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log('Screenshot saved to', outPath)
ws.close()
