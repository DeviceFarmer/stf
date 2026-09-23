/* global BigInt */
var crypto = require('crypto')

var adbkeyutil = module.exports = Object.create(null)

// Written out as calls because the lint config predates BigInt literals
var ONE = BigInt(1)
var TWO = BigInt(2)
var EIGHT = BigInt(8)
var BYTE = BigInt(0xff)
var R32 = ONE << BigInt(32)

function toBigInt(forgeBigInteger) {
  return BigInt('0x' + forgeBigInteger.toString(16))
}

function writeLittleEndian(buffer, offset, value, length) {
  var rest = value
  for (var i = 0; i < length; i += 1) {
    buffer[offset + i] = Number(rest & BYTE)
    rest >>= EIGHT
  }
}

// Turns a key parsed by adbkit back into the adb format it arrived in (~/.android/adbkey.pub).
// adbkit only hands out the parsed key, but that format is what users paste and what the
// fingerprint is taken from, so it is the one worth storing. The struct is the one adbkit's
// parser reads: word count, n0inv, modulus, rr and exponent, all little endian.
adbkeyutil.encodePublicKey = function(key) {
  var n = toBigInt(key.n)
  var words = Math.ceil(key.n.bitLength() / 32)
  var len = words * 4

  // n0inv is -1 / n mod 2^32. n is odd, so Newton's iteration finds the inverse in five steps.
  var n0 = n % R32
  var inv = ONE
  for (var i = 0; i < 5; i += 1) {
    inv = ((inv * (TWO - n0 * inv)) % R32 + R32) % R32
  }
  var n0inv = (R32 - inv) % R32
  var rr = (ONE << BigInt(len * 8 * 2)) % n

  var struct = Buffer.alloc(4 + 4 + len + len + 4)
  struct.writeUInt32LE(words, 0)
  struct.writeUInt32LE(Number(n0inv), 4)
  writeLittleEndian(struct, 8, n, len)
  writeLittleEndian(struct, 8 + len, rr, len)
  struct.writeUInt32LE(Number(toBigInt(key.e)), 8 + len + len)

  var fingerprint = crypto.createHash('md5').update(struct).digest('hex').match(/../g).join(':')
  if (key.fingerprint && fingerprint !== key.fingerprint) {
    throw new Error('Re-encoded key does not match its fingerprint')
  }

  return struct.toString('base64') + (key.comment ? ' ' + key.comment : '')
}
