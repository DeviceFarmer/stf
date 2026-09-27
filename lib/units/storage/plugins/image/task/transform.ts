import gm from 'gm'
import Promise from 'bluebird'
import type {Readable} from 'stream'

interface TransformOptions {
  crop: {width: number, height: number} | null
  gravity: string | null
}

export default function(stream: Readable, options: TransformOptions) {
  return new Promise<Readable>(function(resolve, reject) {
    var transform = gm(stream)

    if (options.gravity) {
      transform.gravity(options.gravity)
    }

    if (options.crop) {
      transform.geometry(options.crop.width, options.crop.height, '^')
      transform.crop(options.crop.width, options.crop.height, 0, 0)
    }

    transform.stream(function(err, stdout) {
      if (err) {
        reject(err)
      }
      else {
        resolve(stdout)
      }
    })
  })
}
