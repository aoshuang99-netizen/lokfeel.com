/**
 * 源码注释剥离 —— 词法级，而不是正则级。
 *
 * 为什么不能简单 `replace(/\/\/.*$/gm, '')`：
 *   `const base = "https://app.lokfeel.com"` 里的 `//` 会被误删，
 *   于是同一行后面的 `process.env.X` 一起消失 —— 门禁"通过"，但什么都没检查。
 *   反过来，`const x = 1; // process.env.FOO` 这种**行尾注释**又必须剥掉，
 *   否则会把注释里的键当成真实引用（假红）。
 * 两种错都会让门禁失去意义，所以这里按字符串状态机走一遍。
 */

export function stripComments(src) {
  let out = ''
  let i = 0
  let state = null // null | "'" | '"' | '`' | '//' | '/*'

  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]

    if (state === null) {
      if (c === '/' && n === '/') {
        state = '//'
        i += 2
        continue
      }
      if (c === '/' && n === '*') {
        state = '/*'
        i += 2
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }

    if (state === '//') {
      if (c === '\n') {
        state = null
        out += c
      }
      i++
      continue
    }

    if (state === '/*') {
      if (c === '*' && n === '/') {
        state = null
        i += 2
        continue
      }
      if (c === '\n') out += c // 保留行号，方便报错定位
      i++
      continue
    }

    // 字符串内部
    if (c === '\\') {
      out += c + (n ?? '')
      i += 2
      continue
    }
    if (c === state) state = null
    out += c
    i++
  }

  return out
}
