const MAX_DECODE_QUEUE = 6
const FIRST_FRAME_TIMEOUT_MS = 6000
const FRAME_TIMEOUT_MS = 15000

export function supportsHevcScreen(): boolean {
  return typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function'
}

export function startHevcScreen(header: string, callbacks: {
  onFrame: (frame: VideoFrame) => void
  onKeyframe: () => void
  onError: (reason: 'unsupported' | 'unavailable') => void
}): {receive: (data: ArrayBuffer) => void; close: () => void} {
  let decoder: VideoDecoder | null = null
  let config: VideoDecoderConfig | null = null
  let closed = false
  let waitingForKey = true
  let buffered: Uint8Array<ArrayBuffer>[] = []
  let submitted = 0
  let timestamp = 0
  let firstValidTimestamp = 0
  let watchdog = setTimeout(unavailable, FIRST_FRAME_TIMEOUT_MS)

  function close() {
    closed = true
    clearTimeout(watchdog)
    buffered = []
    if (decoder && decoder.state !== 'closed') {
      decoder.close()
    }
  }

  function fail(reason: 'unsupported' | 'unavailable') {
    if (!closed) {
      close()
      callbacks.onError(reason)
    }
  }

  function unavailable() {
    fail('unavailable')
  }

  function output(frame: VideoFrame) {
    try {
      if (!closed && frame.timestamp >= firstValidTimestamp) {
        submitted -= 1
        clearTimeout(watchdog)
        watchdog = setTimeout(unavailable, FRAME_TIMEOUT_MS)
        callbacks.onFrame(frame)
      }
    }
    catch {
      unavailable()
    }
    finally {
      frame.close()
    }
  }

  function decode(frame: Uint8Array<ArrayBuffer>) {
    if (!decoder || !config || closed) {
      return
    }
    const key = frame[0] !== 1
    if (waitingForKey && !key) {
      return
    }
    try {
      if ((frame[0] === 2 && !waitingForKey) ||
        Math.max(submitted, decoder.decodeQueueSize) >= MAX_DECODE_QUEUE) {
        // Deltas after a drop cannot be decoded against the old reference frames.
        decoder.reset()
        decoder.configure(config)
        submitted = 0
        firstValidTimestamp = timestamp + 1
        if (!key) {
          waitingForKey = true
          callbacks.onKeyframe()
          return
        }
      }
      waitingForKey = false
      timestamp = Math.max(timestamp + 1, Math.round(performance.now() * 1000))
      decoder.decode(new EncodedVideoChunk({
        type: key ? 'key' : 'delta', timestamp, data: frame.subarray(1)
      }))
      submitted += 1
    }
    catch {
      unavailable()
    }
  }

  function receive(data: ArrayBuffer) {
    if (closed || data.byteLength < 2) {
      return
    }
    const frame = new Uint8Array(data)
    const kind = frame[0]
    if (kind !== 0 && kind !== 1 && kind !== 2) {
      return
    }
    if (decoder) {
      decode(frame)
    }
    else if (kind !== 1) {
      buffered = [frame]
    }
    else if (buffered.length) {
      if (buffered.length < MAX_DECODE_QUEUE) {
        buffered.push(frame)
      }
      else {
        buffered = []
      }
    }
  }

  Promise.resolve().then(async() => {
    if (closed) {
      return
    }
    const {codec, description} = JSON.parse(header) as {codec?: unknown; description?: unknown}
    if (typeof codec !== 'string' || !/^(hev1|hvc1)\./.test(codec) ||
      typeof description !== 'string' || !description || description.length > 4096) {
      unavailable()
      return
    }
    config = {codec, description: Uint8Array.from(atob(description), byte => byte.charCodeAt(0))
      , optimizeForLatency: true}
    const support = await VideoDecoder.isConfigSupported(config)
    if (closed) {
      return
    }
    if (!support.supported) {
      fail('unsupported')
      return
    }
    decoder = new VideoDecoder({output, error: unavailable})
    decoder.configure(config)
    const initial = buffered
    buffered = []
    if (initial.length) {
      initial.forEach(decode)
    }
    else {
      callbacks.onKeyframe()
    }
  }).catch(unavailable)

  return {receive, close}
}
