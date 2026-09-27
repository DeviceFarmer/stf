import crypto from 'crypto'

// See http://graphics.stanford.edu/~seander/bithacks.html#ReverseByteWith32Bits
function reverseByteBits(b: number) {
  return (((b * 0x0802 & 0x22110) |
  (b * 0x8020 & 0x88440)) * 0x10101 >> 16 & 0xFF)
}

function reverseBufferByteBits(b: Buffer) {
  var result = Buffer.alloc(b.length)

  for (var i = 0; i < result.length; ++i) {
    result[i] = reverseByteBits(b[i]!)
  }

  return result
}

function normalizePassword(password: Buffer) {
  var key = Buffer.alloc(8).fill(0)

  // Make sure the key is always 8 bytes long. VNC passwords cannot be
  // longer than 8 bytes. Shorter passwords are padded with zeroes.
  reverseBufferByteBits(password).copy(key, 0, 0, 8)

  return key
}

function encrypt(challenge: Buffer, password: Buffer) {
  var key = normalizePassword(password)
  var iv = Buffer.alloc(0).fill(0)

  // Note: do not call .final(), .update() is the one that gives us the
  // desired result.
  return crypto.createCipheriv('des-ecb', key, iv).update(challenge)
}

function verify(response: Buffer, challenge: Buffer, password: Buffer) {
  return encrypt(challenge, password).equals(response)
}

export default {encrypt, verify}
