/**
 * `/__slow` 宿主的两道闸。
 *
 * 它是一个会花 credits、会把文件写到现场机器的口子，所以“浏览器页面是本地的”
 * 不够：Vite `--host` 会让同一局域网的人直接打到中间件。真正的边界是
 * socket 的 remoteAddress 必须是 loopback；不信 `Host` / `X-Forwarded-For` 这些请求方能写的字段。
 *
 * dev 下本机可用（现有工作流）；preview 还要多一道 `SLOW_ENABLE=1`，免得普通的
 * 生产包预览意外变成生成服务。Vercel 不跑 Vite preview，所以这段不会把线上版开起来。
 */

export type SlowHostMode = 'dev' | 'preview';

export function isLoopbackAddress(raw: string | null | undefined): boolean {
  const address = (raw ?? '').toLowerCase().split('%')[0];
  return address === '::1'
    || address === '0:0:0:0:0:0:0:1'
    || address === '::ffff:7f00:1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.');
}

export function shouldServeSlow(
  mode: SlowHostMode,
  remoteAddress: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!isLoopbackAddress(remoteAddress)) return false;
  return mode === 'dev' || env.SLOW_ENABLE === '1';
}
