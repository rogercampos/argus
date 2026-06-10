// Temporary verification helper: evaluate an expression in the running app
const [, , port = '9222', expression] = process.argv

const targets = await (await fetch(`http://localhost:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

const id = 1
ws.send(
  JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })
)
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === id) {
    console.log(JSON.stringify(msg.result, null, 2))
    ws.close()
    process.exit(0)
  }
}
