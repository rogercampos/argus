// Temporary verification helper: dispatch a key event with modifiers
// Usage: node cdp-key.mjs <port> <key> <code> <modifiers>
// modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8

const [, , port = '9222', key = '1', code = 'Digit1', modifiers = '4'] = process.argv

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

const mods = Number(modifiers)
await send('Input.dispatchKeyEvent', {
  type: 'rawKeyDown',
  key,
  code,
  modifiers: mods,
  windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
})
await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mods })
console.log(`sent ${key} (modifiers=${mods})`)
ws.close()
