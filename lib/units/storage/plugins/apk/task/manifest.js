var ApkReader = require('@devicefarmer/adbkit-apkreader')
var IpaReader = require('../../../../../util/ipareader')

module.exports = function(file) {
  if(file.path.endsWith('.apk')){
    return ApkReader.open(file.path).then(function(reader) {
      return reader.readManifest()
    })
  }
  else if(file.path.endsWith('.ipa')){
    var ipaReader = new IpaReader(file.path)
    return ipaReader.ReadInfoPlist().then(function(res){
      return res
    })
  }
}
