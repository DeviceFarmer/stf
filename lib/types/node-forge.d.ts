declare module 'node-forge' {
  namespace jsbn {
    interface BigInteger {
      toString(radix?: number): string
      bitLength(): number
    }
  }

  namespace pki {
    namespace rsa {
      interface PublicKey {
        n: jsbn.BigInteger
        e: jsbn.BigInteger
      }
    }
  }
}
