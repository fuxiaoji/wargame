/** C++ 引擎桥接器 — 通过子进程 stdin/stdout 通信 */
import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'

const BRIDGE_PATH = join(import.meta.dirname, '..', 'cppre', 'bridge')

if (!existsSync(BRIDGE_PATH)) {
  console.error('C++ bridge 未编译。请在 cppre/ 下运行: g++ -std=c++20 -O2 bridge.cpp -o bridge')
}

// 请求队列，保证请求-响应一对一匹配
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }
const queue: Pending[] = []

let proc: ReturnType<typeof spawn> | null = null
let ready = false

function ensureProc(): Promise<void> {
  return new Promise((resolve) => {
    if (proc && !proc.killed && ready) { resolve(); return }

    proc = spawn(BRIDGE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''

    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          const p = queue.shift()
          if (p) p.resolve(data)
        } catch (e) {
          const p = queue.shift()
          if (p) p.reject(new Error('JSON parse error'))
        }
      }
    })

    proc.stderr!.on('data', (d: Buffer) => process.stderr.write(d))
    proc.on('exit', (code) => { proc = null; ready = false })
    proc.on('spawn', () => { ready = true; resolve() })

    // 如果进程已经在 spawn 事件之后了
    setTimeout(() => { if (!ready) { ready = true; resolve() } }, 200)
  })
}

export async function send(method: string, arg1 = '', arg2 = '', arg3 = ''): Promise<any> {
  await ensureProc()

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ method, arg1, arg2, arg3 }) + '\n'
    queue.push({ resolve, reject })
    proc!.stdin!.write(payload)

    setTimeout(() => {
      // 超时清理：从队列中移除自己的 pending
      const idx = queue.findIndex(p => p.resolve === resolve)
      if (idx >= 0) { queue.splice(idx, 1); reject(new Error('C++ bridge timeout')) }
    }, 5000)
  })
}
