// Temporary verification helper: capture a screenshot of the running app via CDP
import { writeFileSync } from 'node:fs'

const port = process.argv[2] ?? '9222'
const outPath = process.argv[3] ?? '/tmp/argus-screenshot.png'

const targets = await (await fetch(`http://localhost:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('No page target found')

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

const evalResult = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('file-tree').length + ' file-tree elements; body text length: ' + document.body.innerText.length`,
  returnByValue: true
})
console.log('DOM check:', evalResult.result.value)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log('Screenshot saved to', outPath)
ws.close()
