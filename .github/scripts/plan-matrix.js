//
// Emit the Android job matrix from .github/android-matrix.json.
//
// usage: node plan-matrix.js [matrix.json]
//
// The report job reads the same file to decide which legs it expected, so a leg
// cannot be added to the matrix and silently escape the coverage check.
//

var fs = require('fs')

function main() {
  var file = process.argv[2] || '.github/android-matrix.json'
  var spec = JSON.parse(fs.readFileSync(file, 'utf8'))
  var include = spec.include || []

  if (!include.length) {
    throw new Error('android-matrix.json has no legs')
  }
  var apis = include.map(function(leg) {
    return leg.api
  })
  var duplicates = apis.filter(function(api, index) {
    return apis.indexOf(api) !== index
  })
  if (duplicates.length) {
    throw new Error('duplicate api values: ' + duplicates.join(', '))
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT
    , 'matrix=' + JSON.stringify({include: include}) + '\n')
  }
  console.log(include.length + ' Android legs planned')
}

main()
